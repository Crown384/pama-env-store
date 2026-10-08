import { httpRouter } from "convex/server";
import { machine } from "./machine";

const http = httpRouter();
http.route({ path: "/machine", method: "GET", handler: machine });
export default http;
