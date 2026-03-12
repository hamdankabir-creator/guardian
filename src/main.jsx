import React from "react";
import ReactDOM from "react-dom/client";
import GuardianDemo from "./GuardianDemo";
import ParentDashboard from "./ParentDashboard";

const view = new URLSearchParams(window.location.search).get("view");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {view === "parent" ? <ParentDashboard /> : <GuardianDemo />}
  </React.StrictMode>
);
