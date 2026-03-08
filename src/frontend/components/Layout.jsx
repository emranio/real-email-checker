import { Outlet } from "react-router-dom";
import Header from "./Header.jsx";
import Footer from "./Footer.jsx";

export default function Layout() {
  return (
    <div className="container">
      <Header />
      <main>
        <div className="content">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  );
}
