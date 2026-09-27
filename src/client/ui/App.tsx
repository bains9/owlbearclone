import { Home } from "./Home";
import { RoomPage } from "./RoomPage";

export function App() {
  const path = location.pathname;
  const m = path.match(/^\/r\/([A-Za-z0-9]{1,64})\/?$/);
  if (m) return <RoomPage roomId={m[1]} />;
  if (path === "/" || path === "") return <Home />;
  return (
    <div class="center-page">
      <div class="card">
        <h1>Nothing here</h1>
        <p class="muted">That page doesn't exist.</p>
        <a class="btn btn-primary" href="/">
          Go to the start page
        </a>
      </div>
    </div>
  );
}
