import { useRoute } from "./route";
import { Footer, TopBar } from "./ui/Shell";
import { Overview } from "./pages/Overview";
import { Agents } from "./pages/Agents";
import { Activity } from "./pages/Activity";
import { OpenLine } from "./pages/OpenLine";

const PAGES = { overview: Overview, agents: Agents, activity: Activity, open: OpenLine };
const TITLES = { overview: "Overview", agents: "Agents", activity: "Activity", open: "Open a line" };

export function App() {
  const { route } = useRoute();
  const Page = PAGES[route];
  document.title = `BanQor · ${TITLES[route]}`;
  return (
    <>
      <TopBar />
      <main className="shell">
        <Page />
        <Footer />
      </main>
    </>
  );
}
