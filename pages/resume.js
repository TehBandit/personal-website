import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
// import Cursor from "../components/Cursor";
import Head from "next/head";
import Header from "../components/Header";
// import ProjectResume from "../components/ProjectResume";
// import Socials from "../components/Socials";
import Button from "../components/Button";
import { useTheme } from "next-themes";
import { SocialIcon } from 'react-social-icons';
// // Data
import { name } from "../data/portfolio.json";
// import { resume } from "../data/portfolio.json";

const Resume = () => {
  const router = useRouter();
  const { theme } = useTheme();
  return ( 
      <div className="relative">
        <div className="gradient-circle"></div>
        {/* <div className="gradient-circle-bottom"></div> */}
        
        <div className="container mx-auto mb-10">
          
        <Header></Header>

        {/* Find a way to align this right */}

          <div className={`grid grid-cols-7 rounded-md grid-flow-row mt-8 ${theme === "dark" ? "bg-slate-800" : "bg-slate-200"}`}>
            <div className={`col-span-6 rounded-tl-md ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>
              <div className="pl-4 py-4 border-b-2 border-slate-900 flex justify-start">
                <img src="https://media-exp1.licdn.com/dms/image/C4D03AQGuko8KVfWHtw/profile-displayphoto-shrink_200_200/0/1626469614276?e=1672272000&v=beta&t=YgMI6NBbDKBjfy6VjQ1pgxVaiWCuY2E3SEbwwvBn-rY" alt="me" className={`rounded-full h-20 border-2 border-slate-900 ${theme === "dark" ? "border-white" : "border-black"}`}></img>
                <div>
                  <div className="ml-3 text-2xl font-bold pt-2 -mb-2 ">marcus taylor</div>
                  {/* probably hide the twitter later */}
                  {/* <SocialIcon url="https://twitter.com/stinkywittlerat" bgColor="#1e293b" className="scale-50" /> */}
                  <SocialIcon url="https://github.com/TehBandit" bgColor="#1e293b" className="scale-50" />
                  <SocialIcon url="https://instagram.com/artworkbymarcus" bgColor="#1e293b" className="scale-50" />
                  <SocialIcon url="https://linkedin.com/in/taylor-marcus/" bgColor="#1e293b" className="scale-50" />
                </div>
              </div>
              
            </div>
            <div className={`col-span-1 border-b-2 border-slate-900 rounded-tr-md ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>
              <div className="mr-2 mt-8 italic break-words">taylor.marcus99@gmail.com</div>
              {/* <div>(757) 880-4645</div> */}
            </div>
            <div className={`break-words border-r-2 border-slate-900 px-4 py-2 col-span-1 text-xl font-bold flex justify-end ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>experience</div>
              <div className="mx-4 my-2 col-span-5">
                <div className="text-lg font-bold">deloitte consulting - data analyst</div>
                <div className="mx-4">
                  <li className="mb-1">perform data analytics and visualization using semoss, R, python, and javascript</li>
                  <li className="mb-1">plan, develop, and present use cases for united states government and environmental clientele</li>
                  <li className="mb-1">develop, maintain databases and ensure data security</li>
                  <li className="mb-1">develop training and marketing materials for launched use cases</li>
                  <li className="mb-1">perform market analyses and go-to-market research</li>
                </div>
              </div>
              <div className="break-words mx-4 my-2 italic col-span-1">(july 2021 - present)</div>
            <div className={`break-words border-r-2 border-slate-900 px-4 py-2 col-span-1 text-xl font-bold flex justify-end ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>education</div>
              <div className="mx-4 my-2 col-span-5">
                <div className="text-lg font-bold">virginia tech</div>
                <div className="mx-4">
                  <li className="mb-1">bachelors of science - fintech & big data analytics</li>
                  <li>bachelors of science - business information technology (computer decision support systems)</li>
                </div>
              </div>
              <div className="break-words mx-4 my-2 italic col-span-1">(sept 2017- may 2021)</div>
            <div className={`break-words border-r-2 border-slate-900 px-4 py-2 col-span-1 text-xl font-bold flex justify-end ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>certifications</div>
              <div className="mx-4 my-2 col-span-5">
                <div className="text-xl font-bold">united states secret-level clearance</div>
                <div className="mx-4">
                  <li className="mb-1">active common access card</li>
                </div>
              </div>
              <div className="break-words mx-4 my-2 italic col-span-1">(may 2022 - present)</div>
            <div className={`break-words border-r-2 border-slate-900 px-4 py-2 col-span-1 text-xl font-bold flex justify-end ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>skills</div>
            <div className="mx-4 my-2 col-span-5">
              <div className="grid grid-cols-3 bg-slate-700 rounded-md grid-flow-row content-center border-2 border-slate-900 mt-4 mb-12">
                <div className={`col-span-1 rounded-tl-md flex justify-center border-b-2 border-r-2 border-slate-900 ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"}`}>languages</div>
                <div className={`col-span-1 ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"} flex justify-center border-b-2 border-r-2 border-slate-900`}>frameworks</div>
                <div className={`col-span-1 ${theme === "dark" ? "bg-slate-700" : "bg-slate-400"} rounded-tr-md flex justify-center border-b-2 border-slate-900`}>tools</div>
                <div className={`col-span-1 ${theme === "dark" ? "bg-slate-500" : "bg-slate-300"} border-r-2 border-slate-900 p-2`}>
                  <li>r <i>(advanced)</i></li>
                  <li>python <i>(advanced)</i></li>
                  <li>sql <i>(advanced)</i></li>
                  <li>java<i>(intermediate)</i></li>
                  <li>javascript <i>(intermediate)</i></li>
                  <li>html/css3 <i>(intermediate)</i></li>
                  <li>latex <i>(beginner)</i></li>
                </div>
                <div className={`col-span-1 ${theme === "dark" ? "bg-slate-500" : "bg-slate-300"} border-r-2 border-slate-900 p-2`}>
                  <li>react <i>(beginner)</i></li>
                </div>
                <div className={`col-span-1 ${theme === "dark" ? "bg-slate-500" : "bg-slate-300"} border-slate-900 p-2`}>
                  <li>microsoft excel <i>(advanced)</i></li>
                  <li>mysql <i>(advanced)</i></li>
                  <li>rstudio <i>(advanced)</i></li>
                  <li>git <i>(intermediate)</i></li>
                </div>
              </div>
            </div>
          </div>
            <div className="bg-emerald-600 px-4 py-2 rounded-tr-full rounded-br-full w-fit flex justify-center mt-4 drop-shadow-xl">
              <a className="font-bold flex content-end pr-2" href='/images/lorem-ipsum.pdf' download>Download as PDF</a>
            </div>
        </div>
      </div>
  );
};

export default Resume;
