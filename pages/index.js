import React, { useRef, useEffect, useState } from "react";
import Header from "../components/Header";
import ServiceCard from "../components/ServiceCard";
import Socials from "../components/Socials";
import WorkCard from "../components/WorkCard";
import { useIsomorphicLayoutEffect } from "../utils";
import { stagger } from "../animations";
import Footer from "../components/Footer";
import Head from "next/head";
import Button from "../components/Button";
import Link from "next/link";
import { useTheme } from "next-themes";

// Local Data
import data from "../data/portfolio.json";

export default function Home() {
  // Ref
  const workRef = useRef();
  const aboutRef = useRef();
  const textOne = useRef();
  const textTwo = useRef();
  const textThree = useRef();
  const textFour = useRef();
  let { theme, setTheme } = useTheme();
  

  // Handling Scroll
  const handleWorkScroll = () => {
    window.scrollTo({
      top: workRef.current.offsetTop,
      left: 0,
      behavior: "smooth",
    });
  };

  const handleAboutScroll = () => {
    window.scrollTo({
      top: aboutRef.current.offsetTop,
      left: 0,
      behavior: "smooth",
    });
  };

  useIsomorphicLayoutEffect(() => {
    stagger(
      [textOne.current, textTwo.current, textThree.current, textFour.current],
      { y: 40, x: -10, transform: "scale(0.95) skew(10deg)" },
      { y: 0, x: 0, transform: "scale(1)" }
    );
  }, []);

  return (
    <div className="relative">
      
      <Head>
        <title>{data.name}</title>
      </Head>

      <div className="gradient-circle"></div>
      <div className="gradient-circle-bottom"></div>

      <div className="container mx-auto mb-10">
        <Header
          handleWorkScroll={handleWorkScroll}
          handleAboutScroll={handleAboutScroll}
        />
        <div className="laptop:mt-20 mt-10">
          <div className="flex justify-start align-middle">
            <div className="">
              <img src="https://pbs.twimg.com/profile_images/1481111130789629956/HJYE97br_400x400.jpg" alt="me" className={`drop-shadow-2xl rounded-full mr-16 border-8 border-double ${theme === "dark" ? "border-white" : "border-black"}`}></img>
              <Socials className="mt-2 laptop:mt-5 justify-center mr-16" color={`${theme === "dark" ? "#FAF9F6" : "#313639"}`} />
            </div>
            <div className="mt-5">
              <h1
                ref={textOne}
                className="text-3xl tablet:text-6xl laptop:text-6xl laptopl:text-8xl p-1 tablet:p-2 text-bold mob:w-full"
              >
                {data.headerTaglineOne}
              </h1>
              <h1
                ref={textTwo}
                className="text-3xl tablet:text-6xl laptop:text-6xl laptopl:text-8xl p-1 tablet:p-2 text-bold w-full"
              >
                {data.headerTaglineTwo}
              </h1>
              <h1
                ref={textThree}
                className="text-xl tablet:text-6xl laptop:text-6xl laptopl:text-6xl p-1 tablet:p-2 text-bold w-full"
              >
                {data.headerTaglineThree}
              </h1>
              <h1
                ref={textFour}
                className="text-xl tablet:text-6xl laptop:text-6xl laptopl:text-6xl p-1 tablet:p-2 text-bold w-full"
              >
                {data.headerTaglineFour}
              </h1>
            </div>
          </div>
        </div>

        <div className="mt-10 laptop:mt-10 p-2 laptop:p-0">
          <h1 className="text-2xl font-medium border-b-2 border-b-white-500 w-1/3">first update since i havent implemented the blog page yet</h1>
          <p className="tablet:m-10 mt-2 text-xl italic w-11/12">
            first update on a project in progress:
            <br></br>
            <br></br>
            we are so back
            <img src="https://i.imgur.com/z0iXOun.png"></img>
          </p>
        </div>

        <div className="mt-10 laptop:mt-10 p-2 laptop:p-0" ref={aboutRef}>
          <h1 className="text-2xl font-medium border-b-2 border-b-white-500 w-1/12">about me</h1>
          <p className="tablet:m-10 mt-2 text-xl italic w-11/12">
            {data.aboutpara}
          </p>
        </div>

        <div className="mt-50 p-2 laptop:p-0" ref={workRef}>
          <h1 className="text-2xl font-medium border-b-2 border-b-white-500 w-1/12">what i do</h1>

          <div className="mt-5 laptop:mt-10 grid grid-cols-1 tablet:grid-cols-3 gap-1">
            {data.projects.map((project) => (
              <WorkCard
                key={project.id}
                img={project.imageSrc}
                name={project.title}
                description={project.description}
                onClick={() => window.open(project.url)}
              />
            ))}
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
