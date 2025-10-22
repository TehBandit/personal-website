import Carousel from "../components/Carousel.jsx";

export const meta = {
  title: "relocating to new york city 😎",
  desc: "goodbye williamsburg, hello williamsburg!",
  slug: "my-second-post",
  date: "8/26/2025",
  tag: "Personal",
  headerPhotos: ["/ny1.png", "/ny2.png"],
};

export default function SecondPost() {
  return (
    <div>
      <p className="pb-4">
        as of june 2025, meredith and i have officially relocated to new york
        city! after spending the last few years in arlington, va, we decided it
        was time for a change of scenery and a new adventure. we're excited to
        explore all that the city has to offer and can't wait to see what the
        future holds for us here.
      </p>
      <div className="flex">
        {/* come back to how these are sized.. */}
        <Carousel images={["/ny3.png", "/ny4.png"]} h="h-96" w="w-180"/>
        <div>
          <p className="pl-4 pb-4">
            we've just signed for our apartment in williamsburg, brooklyn and it
            is so cute here. coming from williamsburg, va for the first 18 years
            of life, it feels only fitting to return to a new williamsburg after
            a brief hiatus.
          </p>
          <p className="pl-4 pb-4">
            this will serve as my first life-update on this site... more to come
            soon. i've been trying a lot of fantastic new food, so maybe I can
            try to set up some sort of{" "}
            <span>
              <a
                href="https://beliapp.com/"
                className=" text-blue-500"
                target="_blank"
                rel="noopener noreferrer"
              >
                Beli
              </a>
            </span>{" "}
            API to post my latest reviews here.
          </p>
          <p className="pl-4 pb-4">
            ← i'll be sure to put some images here soon, but for now i have a
            housewarming party to decorate for...
          </p>
        </div>
      </div>
    </div>
  );
}
