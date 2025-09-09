export const meta = {
  title: "testing a dynamic blog timeline",
  desc: "this is my first blog post to test the ant.design timeline component!",
  slug: "my-third-post",
  date: "8/25/2025",
  tag: "Development",
};

export default function SecondPost() {
  return (
    <div>
      <p className="pb-4">
        <span>for my first post, i want to test out the </span>
        <span>
          <a
            href="https://ant.design/components/timeline"
            className=" text-blue-500"
            target="_blank"
            rel="noopener noreferrer"
          >
            ant.design timeline component
          </a>
        </span>
        <span>. while this was definitely intended for more of a literal project roadmap, I was inspired by </span>
        <span>
          <a
            href="https://www.npmjs.com/package/react-vertical-timeline-component"
            className=" text-blue-500"
            target="_blank"
            rel="noopener noreferrer"
          >
            another vertical timeline component
          </a>
        </span>
        <span> that I found online, only to find that it was not supported in the latest version of Tailwind...</span>
      </p>
      <p className="pb-4">so i've took it upon myself to recreate it. it is still a work in progress, but i've got it set up so that i can add posts to my src directory and the component ive built will put it into a cute title card, create a webpage and link for them, and update the homepage with the latest post. next I want to increase the styling of the pages, add some images, etc. to give the page a more creative feel.</p>
      <p className="pb-4">check back soon for more updates!</p>
    </div>
  );
}
