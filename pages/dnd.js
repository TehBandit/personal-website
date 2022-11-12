import React, { useEffect, useState, Fragment } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Header from "../components/Header";
import Button from "../components/Button";
import { useTheme } from "next-themes";
import { SocialIcon } from "react-social-icons";
import { name } from "../data/portfolio.json";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Menu, Transition } from "@headlessui/react";
import { IconContext } from "react-icons";
import { CgMenuRightAlt } from "react-icons/cg";
import {
  BsDice1,
  BsDice2,
  BsDice3,
  BsDice4,
  BsDice5,
  BsDice6,
  BsLock,
} from "react-icons/bs";
import { Dropdown, Selection } from "react-dropdown-now";
import "react-dropdown-now/style.css";

const CharacterCreator = () => {
  const router = useRouter();
  const { theme } = useTheme();
  const [stats, setStats] = useState([]);
  const [mods, setMods] = useState([]);
  const [charName, setCharName] = useState("");
  const [level, setLevel] = useState(1);
  const [prof, setProf] = useState(2);
  const [playerClass, setplayerClass] = useState("Barbarian");
  const [open, setOpen] = useState(false);
  const [clicked, setClicked] = useState(false);

  function classNames(...classes) {
    return classes.filter(Boolean).join(" ");
  }

  function rollDice(faces) {
    let x = Math.floor(Math.random() * faces) + 1;
    return x;
  }

  function rollMultiple(dice, faces) {
    const rolls = [];
    for (let i = 0; i < dice; i++) {
      rolls[i] = rollDice(faces);
    }

    return rolls;
  }

  // roll 4 drop lowest
  function rollStat() {
    var rolls = rollMultiple(4, 6);

    // figure out how this works later
    rolls = rolls.sort().filter((_, i) => i);

    let sum = 0;
    for (const i of rolls) {
      sum += i;
    }
    return sum;
  }

  function rollMultipleStats(number) {
    const stats = [];
    for (let i = 0; i < number; i++) {
      stats[i] = rollStat();
    }

    return stats;
  }

  function findModifier(number) {
    return Math.floor((number - 10) / 2);
  }

  function findAllModifier(stats) {
    const mods = [];
    // Stat mods
    for (let i = 0; i < stats.length; i++) {
      mods[i] = findModifier(stats[i]);
    }

    // AC
    if (mods.length > 0) {
      mods[mods.length] = mods[1] + 10;
    }

    return mods;
  }

  useEffect(() => {
    setMods(findAllModifier(stats));
  }, [stats]);

  useEffect(() => {
    if (level > 1 && (level - 1) % 4 == 0) {
      setProf((level - 1) / 4 + 2);
    }
  }, [[], level]);

  async function fillForm() {
    const formUrl = "/images/CharacterSheet.pdf";
    const formPdfBytes = await fetch(formUrl).then((res) => res.arrayBuffer());

    // Load a PDF with form fields
    const pdfDoc = await PDFDocument.load(formPdfBytes);

    // Get the form containing all the fields
    const form = pdfDoc.getForm();
    // const fields = form.getFields();
    // fields.forEach(field => {
    //   const type = field.constructor.name
    //   const name = field.getName()
    //   console.log(`${type}: ${name}`)
    // })

    // Get all fields in the PDF by their names
    const nameField = form.getTextField("CharacterName");
    const classLevelField = form.getTextField("ClassLevel");
    const bgField = form.getTextField("Background");
    const playerNameField = form.getTextField("PlayerName");
    //i dont really know why this doesnt work
    // const raceField = form.getTextField("Race");
    const alignmentField = form.getTextField("Alignment");
    const xpField = form.getTextField("XP");

    nameField.setText("Mario");
    classLevelField.setText("5 - Barbarian");
    bgField.setText("Adventurer");
    playerNameField.setText("Mingus");
    // raceField.setText("blue");
    alignmentField.setText("white");
    xpField.setText("brown");

    // Serialize the PDFDocument to bytes (a Uint8Array)
    const pdfBytes = await pdfDoc.save();

    // Trigger the browser to download the PDF document
    download(pdfBytes, "characer sheet", "application/pdf");
  }

  return (
    <div className="relative">
      <Head>
        <title>Character Creator</title>
        <script src="https://unpkg.com/pdf-lib@1.11.0"></script>
        <script src="https://unpkg.com/downloadjs@1.4.7"></script>
      </Head>
      <div className="gradient-circle"></div>

      <div className="container mb-10">
        {/* NAV BAR */}

        <div
          id="nav-menu"
          className={`fixed h-[100%] transition-all ease-in-out duration-500 left-0 bg-slate-700 transition-all ease-in-out duration-500 ${
            open ? "w-[25%]" : "w-[3%]"
          }`}
          onMouseEnter={() => {
            if (!clicked) {
              setOpen(true);
            }
          }}
          onMouseLeave={() => {
            if (!clicked) {
              setOpen(false);
            }
          }}
          onClick={() => {
            setClicked(!clicked);
            if (clicked) {
              setOpen(false);
            }
          }}
        >
          <CgMenuRightAlt className="absolute scale-[2.25] right-5 top-[2%]" />
          <BsLock
            className={`absolute scale-[2.25] right-5 transition-all duration-300 top-[6.5%] ${
              clicked ? "" : "opacity-0"
            }`}
          />
          <form>
            <input
              type="text"
              name="name"
              placeholder="Character Name..."
              className="border-2 border-white rounded-md pl-2 py-[2px] bg-slate-800 right-[8vw] text-gray-400 top-[7%] absolute"
              onChange={(e) => setCharName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </form>
            {/* <Dropdown
              className="rounded-md"
              placeholder="Class..."
              options={["Barbarian", "Bard", "Cleric"]}
              value="Select a class..."
              onChange={(value) => console.log(value)}
            /> */}
            <select
              className="absolute w-[51%] right-[8vw] top-[2%] pl-1 text-gray-400 bg-slate-800 border-2 border-white rounded-md"
              onClick={(e) => e.stopPropagation()}
            >
              <option className="italic">Select a class...</option>
              <option>Babarian</option>
              <option>Bard</option>
              <option>Cleric</option>
            </select>

          <button
            class="absolute py-1 rounded-sm font-bold text-white group right-[16vw] top-[12%] w-[30%]"
            onClick={(e) => {
              e.stopPropagation();
              setStats(rollMultipleStats(6));
            }}
          >
            <span className="absolute transform w-[58%] h-[58%] scale-[1.7] pl-[62%] pt-[3%]">
              <BsDice1 className="bg-slate-800 rounded-sm transition duration-300 ease-out group-hover:rotate-90 group-hover:animate-waving-hand group-hover:translate-x-4 group-hover:-translate-y-1" />
            </span>
            <span class="absolute w-full h-full border-2 border-white rounded-md top-0 left-0 bg-slate-900"></span>
            <span class="relative">Roll Stats</span>
          </button>

          <button
            class="absolute w-[30%] py-1 rounded-sm font-bold text-white group right-[5vw] top-[12%]"
            onClick={(e) => {
              e.stopPropagation();
              setLevel(level + 1);
            }}
          >
            <span className="absolute transform w-[58%] h-[58%] scale-[1.7] pl-[59%] pt-[3%]">
              <BsDice3 className="bg-slate-800 rounded-sm transition duration-300 ease-out group-hover:rotate-90 group-hover:animate-waving-hand group-hover:translate-x-4 group-hover:-translate-y-1" />
            </span>
            <span class="absolute w-full h-full border-2 border-white rounded-md top-0 left-0 bg-slate-900"></span>
            <span class="relative">Level Up</span>
          </button>
          <button
            class="absolute w-[30%] py-1 rounded-sm font-bold text-white group right-[16vw] top-[18%]"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <span className="absolute transform w-[58%] h-[58%] scale-[1.7] pl-[58%] pt-[3%]">
              <BsDice6 className="bg-slate-800 rounded-sm transition duration-300 ease-out group-hover:rotate-90 group-hover:animate-waving-hand group-hover:translate-x-4 group-hover:-translate-y-1" />
            </span>
            <span class="absolute w-full h-full border-2 border-white rounded-md top-0 left-0 bg-slate-900"></span>
            <span class="relative">Testing</span>
          </button>
        </div>

        {/* CHARACTER SHEET */}

        {/* 4% vs 33% */}
        <div
          className={`relative w-full transition-all duration-500 ease-in-out ${
            open ? "left-[9.1%] scale-[.52] -translate-y-[24%]" : "left-[4%]"
          }`}
        >
          <img src="/images/CharacterSheet-1.png" />
          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[19.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[0]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[23.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[0]}</div>
          </div>

          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[28.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[1]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[32.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[1]}</div>
          </div>

          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[37.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[2]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[41.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[2]}</div>
          </div>

          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[46.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[3]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[50.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[3]}</div>
          </div>

          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[55.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[4]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[59.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[4]}</div>
          </div>

          <div className="absolute w-[5%] h-[4.3%] left-[6.9%] top-[64.5%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{stats[5]}</div>
          </div>
          <div className="absolute w-[2.4%] h-[1.74%] left-[8.2%] top-[68.8%] flex justify-center items-center">
            <div className="text-black text-[1.3vw] font-bold">{mods[5]}</div>
          </div>

          {/* AC */}
          <div className="absolute w-[5%] h-[4.3%] left-[38%] top-[17.75%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{mods[6]}</div>
          </div>

          {/* Initiative */}
          <div className="absolute w-[5%] h-[4.3%] left-[47.2%] top-[17.75%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{mods[1]}</div>
          </div>

          {/* Class & Level */}
          <div className="absolute left-[44.5%] top-[6.25%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">
              {level} - {playerClass}
            </div>
          </div>

          {/* Proficiency Bonus */}
          <div className="absolute left-[16.63%] top-[21.4%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">+{prof}</div>
          </div>
          <div className="absolute left-[7%] top-[8%] w-[35.2%] flex justify-center items-center">
            <div className="text-black text-[1.5vw] font-bold">{charName}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterCreator;
