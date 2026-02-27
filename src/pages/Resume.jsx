import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import { Download } from "lucide-react";

const PDF_PATH = "/Marcus_Taylor_Resume_2025.pdf";

function Resume() {
  return (
    <>
      <Header />
      <div className="beyond-red-line page-content">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4 pr-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">résumé</h1>
            <p className="text-sm text-gray-400 font-light italic mt-0.5">
              last updated: 10/29/2025
            </p>
          </div>
          <a
            href={PDF_PATH}
            download="Marcus_Taylor_Resume_2025.pdf"
            className="inline-flex items-center gap-2 self-start sm:self-auto bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow transition-colors"
          >
            <Download size={16} />
            download pdf
          </a>
        </div>

        {/* PDF viewer */}
        <div className="w-full flex-1 bg-white rounded-2xl shadow-xl overflow-hidden mb-6 pr-4">
          <iframe
            src={`${PDF_PATH}#toolbar=0&navpanes=0&scrollbar=1`}
            title="Marcus Taylor Resume"
            className="w-full"
            style={{ height: "80vh", border: "none" }}
          />
        </div>
      </div>
      <Footer />
    </>
  );
}

export default Resume;

