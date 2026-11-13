export default function InstagramFeed() {
  // The local wrapper can style Juicer's image inside its document, while the
  // frame stays the same size as the YouTube media area on the homepage.
  return (
    <iframe
      src="/embeds/instagram.html"
      title="Latest Instagram post from @artworkbymarcus"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      className="block h-full w-full border-0"
    />
  );
}
