import { Download, ArrowUpRight } from "lucide-react";
import NotebookLayout, { NotebookTitle } from "../components/NotebookLayout.jsx";
import DoodleSurface from "../components/DoodleSurface.jsx";
import "./Resume.css";

const PDF_PATH = "/Marcus_Taylor_Resume_2025.pdf";

function Resume() {
  return (
    <NotebookLayout>
      <main className="notebook-main home-margin-content">
        <NotebookTitle
          doodle="pencil"
          action={
            <a href={PDF_PATH} download="Marcus_Taylor_Resume_2025.pdf" className="resume-download group">
              <Download size={18} aria-hidden="true" />
              <span className="home-nav-highlight">download pdf</span>
            </a>
          }
        >resume</NotebookTitle>

        <DoodleSurface>
          <section className="resume-paper home-sheet" aria-label="Resume PDF">
            <span className="home-tape resume-tape-left" aria-hidden="true" />
            <span className="home-tape home-tape-blue resume-tape-right" aria-hidden="true" />
            <div className="resume-paper-caption">
              <p className="font-home-mono">last updated: <time dateTime="2025-10-29">10/29/2025</time></p>
              <a href={PDF_PATH} target="_blank" rel="noopener noreferrer" className="resume-open group">
                <span className="home-nav-highlight">open pdf</span>
                <ArrowUpRight size={16} aria-hidden="true" />
                <span className="sr-only"> in a new tab</span>
              </a>
            </div>
            <div className="resume-pdf-frame">
              <iframe
                src={`${PDF_PATH}#toolbar=0&navpanes=0&scrollbar=1`}
                title="Marcus Taylor Resume"
                className="resume-pdf"
              />
            </div>
          </section>
        </DoodleSurface>
      </main>
    </NotebookLayout>
  );
}

export default Resume;

