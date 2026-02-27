import { Link } from "react-router-dom";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";

function NotFound() {
  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col">
      <Header />
      <div className="beyond-red-line flex-1 flex flex-col py-[2vw] pr-[1vw]">
        <div className="bg-white rounded-2xl shadow-xl w-full p-[4vw] flex flex-col items-center gap-4 text-center">
          <div className="text-[15vw] md:text-8xl font-bold text-gray-200 leading-none">404</div>
          <div className="text-xl md:text-2xl font-semibold">page not found</div>
          <div className="text-gray-500 text-base md:text-lg">
            the page you're looking for doesn't exist.
          </div>
          <Link
            to="/"
            className="mt-2 text-blue-700 text-base md:text-lg underline underline-offset-4 hover:text-blue-900 transition-colors"
          >
            ← back to home
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default NotFound;
