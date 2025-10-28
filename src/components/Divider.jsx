const Divider = ({ rotate = 0, text = "divider", w = "w-full" }) => {
  return (
    <div className={`relative w-full md:my-[2vw] my-[4vw] rotate-[${rotate}deg]`}>
      <img
        src="/divider.png"
        alt="divider"
        className="w-full h-[1.5vw] px-[1vw]"
      />
      <p className="left-[10vw] top-[-.1vw] absolute inline-block items-center lg:text-2xl font-semibold px-10 bg-[linear-gradient(to_right,transparent_0%,_#f8f9fa_10%,_#f8f9fa_90%,_transparent_100%)]">
        {text}
      </p>
    </div>
  );
};

export default Divider;
