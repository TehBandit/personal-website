import { Github, Linkedin, Twitter, Mail } from 'lucide-react';
import { Link } from "react-router-dom";
function Header() {
    return (
        <header className="sticky top-0 z-50 border-b-2 border-blue-300 w-full bg-white h-16 mb-6">
                <div className="flex items-center justify-between h-16 w-full px-4">
                    <Link to="/">
                    <div className="flex items-center justify-between">
                    {/* adjust logo later */}
                    
                    <img
                        src="/logo.png"
                        alt="Logo"
                        className="max-h-5 w-auto object-contain"
                    />
                    <img
                        src="/mingus-transparent.png"
                        alt="Profile"
                        className="max-h-12 w-auto object-contain"
                    />
                    
                    </div>
                    </Link>

                    
                    <div className="flex items-center space-x-4">
                        {/* Navigation */}
                        <Link to="/blog">blog</Link>
                        <Link to="/resume">resume</Link>
                        <a 
                        href="https://www.linkedin.com/in/taylor-marcus/" 
                        className="social-link"
                        aria-label="LinkedIn"
                        target="_blank" 
                        rel="noopener noreferrer">
                            <Linkedin size={20} className="text-text-secondary" />
                        </a>
                        <a 
                        href="https://github.com/TehBandit" 
                        className="social-link"
                        aria-label="GitHub"
                        target="_blank" 
                        rel="noopener noreferrer">
                            <Github size={20} className="text-text-secondary" />
                        </a>
                        <a 
                        href="mailto:taylor.marcus99@gmail.com" 
                        className="social-link"
                        aria-label="Instagram"
                        target="_blank" 
                        rel="noopener noreferrer">
                            <Mail size={20} className="text-text-secondary" />
                        </a>
                    </div>
                </div>
        </header>
    );
}

export default Header;