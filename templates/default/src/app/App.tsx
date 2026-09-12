import { NavLink, Navigate, Route, Routes } from "react-router";
import { browserModules } from "./browser-modules.js";
import { WorkbenchPage } from "./workbench-page.js";

export function App() {
  const navigation = browserModules.flatMap((item) => item.navigation);
  const defaultPath = navigation[0]?.to ?? "/work";
  return <div className="app-shell">
    <header className="app-header"><strong>Airic App</strong><nav>{navigation.map((item) => <NavLink key={`${item.to}:${item.label}`} to={item.to}>{item.label}</NavLink>)}<NavLink to="/work">Work</NavLink></nav></header>
    <Routes>
      <Route path="/" element={<Navigate to={defaultPath} replace />} />
      {browserModules.flatMap((item) => item.routes).map((route) => <Route key={route.path} path={route.path} element={route.element} />)}
      <Route path="/work/*" element={<WorkbenchPage />} />
      <Route path="*" element={<main className="page"><h1>Not found</h1><p className="muted">This page does not exist.</p></main>} />
    </Routes>
  </div>;
}
