import { isRoomId } from "../../shared/ids";
import { Home } from "./Home";
import { RoomPage } from "./RoomPage";
import { DisplayPage } from "./TableDisplay";

export function App() {
  const path = location.pathname;
  const m = path.match(/^\/r\/([^/]*)\/?$/);
  if (m && isRoomId(m[1])) {
    const displayKey = new URLSearchParams(location.search).get("display");
    return displayKey !== null ? <DisplayPage roomId={m[1]} displayKey={displayKey} /> : <RoomPage roomId={m[1]} />;
  }
  if (path === "/" || path === "") return <Home />;
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
