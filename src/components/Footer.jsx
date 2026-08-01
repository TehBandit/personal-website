import { Github, Linkedin, Mail } from "lucide-react";
import { Link } from "react-router-dom";
function Footer() {
  return (
    <footer className="mt-auto flex w-full flex-col items-center justify-center border-t-2 border-blue-300 bg-blue-50 p-2">
      <div className="flex items-center space-x-4">
        <a
          href="https://www.linkedin.com/in/taylor-marcus/"
          className="social-link"
          aria-label="LinkedIn"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Linkedin size={20} className="text-text-secondary" />
        </a>
        <a
          href="https://github.com/TehBandit"
          className="social-link"
          aria-label="GitHub"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github size={20} className="text-text-secondary" />
        </a>
        <Link
          to="/contact"
          className="social-link"
          aria-label="Contact"
        >
          <Mail size={20} className="text-text-secondary" />
        </Link>
      </div>
      <p>
        © {new Date().getFullYear()} mingus. Built using Vite & Tailwind CSS.
      </p>
    </footer>
  );
}

export default Footer;
