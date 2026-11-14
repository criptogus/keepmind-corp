import React from "react";
import { createRoot } from "react-dom/client";
import DemoApp from "./App.jsx";
import RealApp from "./RealApp.jsx";
const App = new URLSearchParams(location.search).get("demo") === "1" ? DemoApp : RealApp;
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
