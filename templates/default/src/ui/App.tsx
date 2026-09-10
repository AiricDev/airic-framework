import { NavLink } from "react-router";
import { AppRoutes } from "./routes.js";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>Airic App</strong>
        <nav>
          <NavLink to="/cases">Cases</NavLink>
          <NavLink to="/work">Work</NavLink>
        </nav>
      </header>
      <AppRoutes />
    </div>
  );
}
