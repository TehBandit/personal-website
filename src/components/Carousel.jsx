import { useCallback } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const Carousel = ({ images = [], h="h-128", w="w-full" }) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  if (images.length === 0) return null;

  return (
    <div className={`embla ${h} ${w}`} role="region" aria-label="Post photos">
      <div
        className="embla__viewport touch-pan-y"
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
                alt=""
                aria-hidden="true"
                className="embla__backdrop absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50"
              />
              <img
                src={src}
                alt={`Post photo ${index + 1} of ${images.length}`}
                className="embla__img"
              />
            </div>
          ))}
        </div>

        {images.length > 1 && (
          <>
            <button
              type="button"
              className="absolute left-3 top-1/2 -translate-y-1/2 flex size-11 cursor-pointer items-center justify-center rounded-full border border-gray-300 bg-white/95 text-gray-700 hover:bg-white"
              onClick={scrollPrev}
              aria-label="Previous photo"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 flex size-11 cursor-pointer items-center justify-center rounded-full border border-gray-300 bg-white/95 text-gray-700 hover:bg-white"
              onClick={scrollNext}
              aria-label="Next photo"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Carousel;
