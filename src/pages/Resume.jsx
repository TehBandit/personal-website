import Header from "../components/Header.jsx";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";

function Resume() {
  const docs = [{ uri: "/Marcus_Taylor_Resume_2025.pdf" }];

  return (
    <>
      <Header />
      <div className="beyond-red-line page-content items-center">
        {/* ensure this small header aligns to the top-left of the viewer below */}
        <div className="md:text-2xl self-start text-left mb-2">
          <span className="font-bold">Last Updated: </span>
          <span className="font-light italic text-gray-500">10/29/2025</span>
        </div>
        <div className="md:w-1/2 md:h-[60vw] overflow-scroll w-full max-w-full h-auto">
          <DocViewer documents={docs} pluginRenderers={DocViewerRenderers} />
        </div>
      </div>
    </>
  );
}

export default Resume;
