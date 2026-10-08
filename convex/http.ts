import { httpRouter } from "convex/server";
import { machine } from "./machine";
import { login, logout, admin } from "./admin-http";

const http = httpRouter();
http.route({ path: "/machine", method: "GET", handler: machine });
http.route({ path: "/auth/login", method: "POST", handler: login });
http.route({ path: "/auth/logout", method: "POST", handler: logout });
http.route({ path: "/admin", method: "POST", handler: admin });
export default http;
