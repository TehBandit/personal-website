import "./App.css";
import { Route, Routes } from "react-router-dom";
import Blog from "./pages/Blog.jsx";
import Home from "./pages/Home.jsx";
import BlogPage from "./pages/BlogPage.jsx";
import Civic from "./pages/Civic.jsx";

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPage />} />
        <Route path="/civic" element={<Civic />} />
      </Routes>
    </>
  );
}

export default App;
