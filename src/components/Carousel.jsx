import React, { useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const Carousel = ({ images = ["/vite.svg", "/profile.jpg", "/logo.png"] , h="h-128", w="w-full"}) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  return (
    <div className={`embla ${h} ${w}`}>
      <div
        className="embla__viewport"
        ref={emblaRef}
      >
        <div className="embla__container">
          {images.map((src, index) => (
            <div
              key={index}
              className="embla__slide"
            >
              <img
                src={src}
                alt={`Slide ${index + 1}`}
                className="embla__img"
              />
            </div>
          ))}
        </div>

        {/* Left overlay with gradient + chevron */}
        <div
          className="group absolute left-0 top-0 h-full w-1/5 cursor-pointer transition bg-gradient-to-r from-gray-700/40 to-transparent opacity-0 hover:opacity-100 flex items-center"
          onClick={scrollPrev}
        >
          <ChevronLeft
            size={128}
            className="text-white ml-2 opacity-0 group-hover:opacity-100 transition"
          />
        </div>

        {/* Right overlay with gradient + chevron */}
        <div
          className="group absolute right-0 top-0 h-full w-1/5 cursor-pointer transition bg-gradient-to-l from-gray-700/40 to-transparent opacity-0 hover:opacity-100 flex items-center justify-end"
          onClick={scrollNext}
        >
          <ChevronRight
            size={128}
            className="text-white mr-2 opacity-0 group-hover:opacity-100 transition"
          />
        </div>
      </div>
    </div>
  );
};

export default Carousel;
