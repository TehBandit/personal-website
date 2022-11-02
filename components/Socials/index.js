import React from "react";
import Button from "../Button";
import { SocialIcon } from 'react-social-icons';

import yourData from "../../data/portfolio.json";

const Socials = ({ className, color="" }) => {
  return (
    // <div className={`${className} flex flex-wrap mob:flex-nowrap link`}>
    //   {yourData.socials.map((social, index) => (
    //     <Button key={index} onClick={() => window.open(social.link)}>
    //       {social.title}
    //     </Button>
    //   ))}
    // </div>
    <div className={`${className} flex flex-wrap mob:flex-nowrap link`}>
      {yourData.socials.map((social, index) => (
        <SocialIcon url={social.link} bgColor={color} className="scale-50 hover:scale-75 transition-all ease-out duration-300" key={index} />
      ))}
    </div>
  );
};

export default Socials;
