import {mount,activateIslands} from "@getforma/core";import {Page} from "./page";import {Badge} from "./island";activateIslands({Badge});mount(()=>Page(),"#app");
