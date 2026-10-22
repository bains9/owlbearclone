import { isRoomId } from "../../shared/ids";
import { loadFailure, updatedText } from "../updated";
import type { LoadFailure } from "../updated";
import { Home } from "./Home";
import { RoomPage } from "./RoomPage";
import { DisplayPage } from "./TableDisplay";
import { useEffect, useState } from "preact/hooks";
import type { ComponentType } from "preact";

export function App() {
  const path = location.pathname;
  const m = path.match(/^\/r\/([^/]*)\/?$/);
  if (m && isRoomId(m[1])) {
    const displayKey = new URLSearchParams(location.search).get("display");
    return displayKey !== null ? <DisplayPage roomId={m[1]} displayKey={displayKey} /> : <RoomPage roomId={m[1]} />;
  }
  if (path === "/" || path === "") return <Home />;
  if (path === "/guide" || path === "/guide/") return <GuideRoute />;
  return (
    <div class="center-page">
      <div class="card">
        <h1>{m ? "That room link isn't complete" : "Nothing here"}</h1>
        <p class="muted">
          {m
            ? "A room link ends in a 12-character code. Check you copied the whole link, or ask the GM for it again."
            : "That page doesn't exist."}
        </p>
        <a class="btn btn-primary" href="/">
          Go to the start page
        </a>
      </div>
    </div>
  );
}

/** The guide is big, so it loads only when someone opens it. */
function GuideRoute() {
  const [Page, setPage] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState<LoadFailure | null>(null);
  useEffect(() => {
    void import("./GuidePage").then(
      (m) => setPage(() => m.GuidePage),
      async () => setFailed(await loadFailure()),
    );
  }, []);
  if (Page) return <Page />;
  if (!failed) return <div class="center-page muted">Loading…</div>;
  return (
    <div class="center-page">
      <div class="card">
        <h1>Couldn't load the guide</h1>
        <p class="muted">{failed === "updated" ? updatedText("see the guide") : "Check the connection, then reload the page."}</p>
        <button class="btn btn-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
