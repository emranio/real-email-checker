import dns from "node:dns/promises";
import fs from "node:fs";
import MailChecker from "mailchecker";
import pLimit from "p-limit";
import { verifyRecipientViaSmtp } from "./smtpVerifier.js";

const roleBasedEmails = JSON.parse(
  fs.readFileSync(
    new URL("../../frontend/data/roleBasedEmails.json", import.meta.url),
    "utf8",
  ),
);

const unlikelyPatterns = JSON.parse(
  fs.readFileSync(
    new URL("../../frontend/data/unlikelyPatterns.json", import.meta.url),
    "utf8",
  ),
);

const CACHE_MAX_SIZE = 10000;
const CACHE_TTL_MS = 60 * 60 * 1000;

function createLruCache() {
  const map = new Map();
  return {
    has(key) {
      const entry = map.get(key);
      if (!entry) return false;
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        map.delete(key);
        return false;
      }
      return true;
    },
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      if (map.size >= CACHE_MAX_SIZE) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      map.set(key, { value, ts: Date.now() });
    },
  };
}

const domainCache = createLruCache();
const smtpCache = createLruCache();

let dnsTimeoutMs = 5000;

export function setDnsTimeout(ms) {
  dnsTimeoutMs = ms;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("dns_timeout")), ms),
    ),
  ]);
}

const roleBasedDomains = [
  "example.com",
  "test.com",
  "example.org",
  "test.org",
  "example.net",
  "test.net",
];

const unlikelyDeepPatterns = [
  "fake",
  "invalid",
  "signup",
  "spam",
  "junk",
  "nothanks",
  "notreal",
  "scam",
  "test",
  "dummy",
  "temp",
  "temporary",
  "throwaway",
  "nomail",
  "donotreply",
  "noreply",
  "no-reply",
  "local",
];

function hasUnlikelyDeepPattern(email, patterns) {
  const lowerEmail = email.toLowerCase();

  return patterns.some((pattern) => {
    const regex = new RegExp(`(^|[^a-zA-Z0-9])${pattern}([^a-zA-Z0-9]|$)`, "i");
    return regex.test(lowerEmail);
  });
}

function hasUnlikelyPattern(email, patterns) {
  const lowerEmail = String(email ?? "").toLowerCase();
  const atIndex = lowerEmail.indexOf("@");
  if (atIndex === -1) return false;

  const localPart = lowerEmail.slice(0, atIndex);
  const domainPart = lowerEmail.slice(atIndex + 1);

  return patterns.some((rawPattern) => {
    const pattern = String(rawPattern ?? "")
      .trim()
      .toLowerCase();

    if (!pattern) return false;

    // Domain-prefixed patterns: "@example" or "@fake."
    if (pattern.startsWith("@")) {
      const token = pattern.slice(1);
      if (!token) return false;
      if (token.endsWith(".")) {
        return domainPart.startsWith(token);
      }
      return domainPart === token || domainPart.startsWith(`${token}.`);
    }

    // Local-part exact patterns: "test@", "na@"
    if (pattern.endsWith("@")) {
      const token = pattern.slice(0, -1);
      if (!token) return false;
      return localPart === token;
    }

    // Mixed local@domain patterns such as "xxx@xxx."
    if (pattern.includes("@")) {
      const [localToken, domainToken = ""] = pattern.split("@");

      const localOk = localToken ? localPart === localToken : true;
      let domainOk = true;

      if (domainToken) {
        if (domainToken.endsWith(".")) {
          domainOk = domainPart.startsWith(domainToken);
        } else {
          domainOk =
            domainPart === domainToken ||
            domainPart.startsWith(`${domainToken}.`);
        }
      }

      return localOk && domainOk;
    }

    // TLD-like suffix patterns: ".invalid", ".fake"
    if (pattern.startsWith(".")) {
      return domainPart.endsWith(pattern);
    }

    // Domain typo patterns like "al.com", "gmail.cm", "unknown.com"
    if (pattern.includes(".")) {
      return domainPart === pattern;
    }

    // Generic tokens use boundary-aware matching to avoid accidental substrings.
    const tokenRegex = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i");
    return tokenRegex.test(lowerEmail);
  });
}

function isUnlikelyLocalpartDomainpartCombination(email) {
  const localPart = extractLocalPart(email)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const domainPart = extractDomain(email)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (localPart.length < 3 || domainPart.length < 3) return false;

  if (localPart === domainPart) return true;

  return false;
}

function hasConsecutiveNonAlphanumeric(email) {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return false;

  const localPart = email.substring(0, atIndex);
  return /[^a-zA-Z0-9]{2,}/.test(localPart);
}

function hasExcessiveRepetition(email, maxRepetition) {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return false;

  const localPart = email.substring(0, atIndex);
  const repetitionRegex = new RegExp(`(.)\\1{${maxRepetition - 1},}`, "i");
  return repetitionRegex.test(localPart);
}

function hasBlockedWord(email, words) {
  if (!Array.isArray(words) || words.length === 0) {
    return false;
  }

  const normalizedEmail = String(email ?? "").toLowerCase();
  return words.some((word) => {
    const normalizedWord = String(word ?? "")
      .trim()
      .toLowerCase();
    return normalizedWord && normalizedEmail.includes(normalizedWord);
  });
}

function isValidEmailFormat(email) {
  const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(email);
}

function isRoleBasedEmail(email, roleEmails, roleDomains) {
  const domain = extractDomain(email).toLowerCase();
  const localPart = extractLocalPart(email).toLowerCase();

  if (roleDomains.includes(domain)) {
    return true;
  }

  const roleBasedPatterns = ["no-reply", "noreply", "sales@"];
  if (roleBasedPatterns.some((pattern) => localPart.includes(pattern))) {
    return true;
  }

  return roleEmails.some((role) => localPart === role);
}

function isDisposableEmail(email) {
  return !MailChecker.isValid(email);
}

async function hasValidARecord(email) {
  const domain = extractDomain(email);
  const cacheKey = `a_${domain}`;

  if (domainCache.has(cacheKey)) {
    return domainCache.get(cacheKey);
  }

  try {
    const records = await withTimeout(dns.resolve4(domain), dnsTimeoutMs);
    const hasARecord = Array.isArray(records) && records.length > 0;
    domainCache.set(cacheKey, hasARecord);
    return hasARecord;
  } catch {
    return true;
  }
}

async function hasValidMXRecord(email) {
  const domain = extractDomain(email);
  const cacheKey = `mx_${domain}`;

  if (domainCache.has(cacheKey)) {
    return domainCache.get(cacheKey);
  }

  try {
    const records = await withTimeout(dns.resolveMx(domain), dnsTimeoutMs);
    const hasMX = Array.isArray(records) && records.length > 0;
    domainCache.set(cacheKey, hasMX);
    return hasMX;
  } catch {
    return true;
  }
}

async function verifySmtpRecipient(email, config) {
  const cacheKey = `smtp_${email.toLowerCase()}`;
  if (smtpCache.has(cacheKey)) {
    return smtpCache.get(cacheKey);
  }

  const data = await verifyRecipientViaSmtp(email, config);
  let smtpValid = null;

  if (data?.valid === true) {
    smtpValid = true;
  } else if (data?.reason === "recipient_rejected") {
    smtpValid = false;
  }

  smtpCache.set(cacheKey, smtpValid);
  return smtpValid;
}

function extractDomain(email) {
  return email.split("@")[1] || "";
}

function extractLocalPart(email) {
  return email.split("@")[0] || "";
}

export async function validateEmail(email, options = {}, config = {}) {
  const defaultOptions = {
    allowUnlikely: false,
    allowRoleBased: false,
    allowDisposable: false,
    checkDnsMx: true,
    checkMx: true,
    checkSmtp: false,
    allowNoWebsiteDomain: false,
    maxLocalpartRepetition: 5,
    customBlockedWords: [],
  };

  const opts = { ...defaultOptions, ...options };
  const shouldCheckDnsMx = opts.checkDnsMx ?? opts.checkMx;

  const result = {
    email,
    valid: true,
    reason: null,
    isRoleBased: false,
    isDisposable: false,
    isUnlikely: false,
    hasMx: true,
    hasARecord: true,
    hasSmtp: null,
    smtpChecked: false,
  };

  if (!isValidEmailFormat(email)) {
    result.valid = false;
    result.reason = "invalid format";
    return result;
  }

  if (!opts.allowUnlikely) {
    const localPart = extractLocalPart(email);
    const domain = extractDomain(email);
    const localpartMinLen = 1;
    const localpartMaxLen = 32;
    const domainMinLen = 5;
    const domainMaxLen = 128;

    if (
      localPart.length < localpartMinLen ||
      localPart.length > localpartMaxLen
    ) {
      result.valid = false;
      result.reason = `local part must be between ${localpartMinLen} and ${localpartMaxLen} characters`;
      return result;
    }

    if (domain.length < domainMinLen || domain.length > domainMaxLen) {
      result.valid = false;
      result.reason = `domain must be between ${domainMinLen} and ${domainMaxLen} characters`;
      return result;
    }

    if (!/^[a-z0-9_-]/i.test(localPart) || !/[a-z0-9_-]$/i.test(localPart)) {
      result.valid = false;
      result.reason =
        "local part must start and end with a letter, number, underscore, or hyphen";
      return result;
    }
  }

  const hasUnlikelyPatterns =
    hasUnlikelyPattern(email, unlikelyPatterns) ||
    hasUnlikelyDeepPattern(email, unlikelyDeepPatterns) ||
    hasConsecutiveNonAlphanumeric(email) ||
    isUnlikelyLocalpartDomainpartCombination(email) ||
    hasExcessiveRepetition(email, opts.maxLocalpartRepetition);

  if (hasUnlikelyPatterns) {
    result.isUnlikely = true;
    if (!opts.allowUnlikely) {
      result.valid = false;
      result.reason = "Email seems unlikely to be valid";
      return result;
    }
  }

  result.isRoleBased = isRoleBasedEmail(
    email,
    roleBasedEmails,
    roleBasedDomains,
  );
  if (!opts.allowRoleBased && result.isRoleBased) {
    result.valid = false;
    result.reason = "role-based email";
    return result;
  }

  result.isDisposable = isDisposableEmail(email);
  if (!opts.allowDisposable && result.isDisposable) {
    result.valid = false;
    result.reason = "disposable email";
    return result;
  }

  if (hasBlockedWord(email, opts.customBlockedWords)) {
    result.valid = false;
    result.reason = "contains blocked word";
    return result;
  }

  if (shouldCheckDnsMx || !opts.allowNoWebsiteDomain) {
    const dnsChecks = [];
    if (shouldCheckDnsMx) dnsChecks.push(hasValidMXRecord(email));
    else dnsChecks.push(Promise.resolve(true));
    if (!opts.allowNoWebsiteDomain) dnsChecks.push(hasValidARecord(email));
    else dnsChecks.push(Promise.resolve(true));

    const [mxResult, aResult] = await Promise.all(dnsChecks);

    result.hasMx = mxResult;
    if (!result.hasMx) {
      result.valid = false;
      result.reason = "no valid MX record";
      return result;
    }

    result.hasARecord = aResult;
    if (!result.hasARecord) {
      result.valid = false;
      result.reason = "domain has no website";
      return result;
    }
  }

  if (opts.checkSmtp) {
    result.smtpChecked = true;
    result.hasSmtp = await verifySmtpRecipient(email, config);

    if (result.hasSmtp === false) {
      result.valid = false;
      result.reason = "smtp rejected recipient";
      return result;
    }
  }

  return result;
}

export async function validateEmailBatch(
  emails = [],
  options = {},
  config = {},
) {
  const concurrency = config.runWorkerConcurrency || 20;
  const limit = pLimit(concurrency);
  const normalizedEmails = Array.isArray(emails)
    ? emails.map((item) => String(item ?? ""))
    : [];

  return Promise.all(
    normalizedEmails.map((email) =>
      limit(() => validateEmail(email, options, config)),
    ),
  );
}
