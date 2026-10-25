// Voice chat's controls: its part of the Chat & dice panel, the microphone button in the
// zoom box, and the overlay on the map showing who's talking.

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Headphones, Mic, MicOff, PhoneOff, VolumeX } from "lucide-preact";
import type { VoicePeer } from "../../shared/voice";
import type { RoomClient } from "../room/client";
import { keyName, usableTalkKey, voiceMode } from "../room/voice";
import { cx, useRoom, useRoomState } from "./common";

/** Whether this browser lets a page set a sound's volume (an iPhone or iPad doesn't). */
let volumeWorks: boolean | null = null;
function canSetVolume(): boolean {
  if (volumeWorks === null) {
    try {
      const a = document.createElement("audio");
      a.volume = 0.5;
      volumeWorks = a.volume === 0.5;
    } catch {
      volumeWorks = true;
    }
  }
  return volumeWorks;
}

/** A person's first letter (or first emoji) for their circle. */
function initial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

/** Press-and-hold for push to talk, with a mouse, a finger, or Space or Enter on the focused button. */
function holdToTalk(room: RoomClient): JSX.HTMLAttributes<HTMLButtonElement> {
  const stop = () => room.voice.setTalking(false);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      room.voice.setTalking(true);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onContextMenu: (e) => e.preventDefault(),
    onKeyDown: (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (!e.repeat) room.voice.setTalking(true);
    },
    onKeyUp: (e) => {
      if (e.key === " " || e.key === "Enter") stop();
    },
    onBlur: stop,
  };
}

/** Voice chat at the top of the Chat & dice panel. */
export function VoiceSection() {
  const room = useRoom();
  const v = useRoomState((s) => s.voice);
  const me = useRoomState((s) => s.me);
  const gm = me?.role === "gm";
  const mode = voiceMode(v, gm);
  const on = v.status === "on";
  const n = v.peers.length;
  return (
    <section class={cx("voice", on && "on")} aria-label="Voice chat">
      <div class="voice-head">
        <Headphones size={16} aria-hidden="true" />
        <span class="voice-title">Voice chat</span>
        <span class="voice-count">{n === 0 ? "nobody in it" : n === 1 ? "1 person" : `${n} people`}</span>
        {v.status === "off" && (
          <button class="btn btn-primary btn-sm voice-join" onClick={() => void room.voice.join()}>
            <Mic size={14} /> Join voice
          </button>
        )}
        {v.status === "starting" && (
          <button class="btn btn-sm voice-leave" onClick={() => room.voice.leave()}>
            Cancel
          </button>
        )}
        {on && (
          <button class="btn btn-sm voice-leave" onClick={() => room.voice.leave()}>
            <PhoneOff size={14} /> Leave
          </button>
        )}
      </div>
      {v.status === "starting" && <p class="voice-note">Asking for your microphone. If your browser asks, allow it.</p>}
      {on && (
        <div class="voice-controls">
          <label class="check voice-ptt" title="Your microphone is on only while you hold the key or the button">
            <input
              type="checkbox"
              checked={mode === "ptt"}
              onChange={(e) => room.voice.setMode(e.currentTarget.checked ? "ptt" : "open")}
            />
            Push to talk
          </label>
          {mode === "ptt" && <KeyPicker />}
          {mode === "ptt" ? (
            <TalkButton />
          ) : (
            <button class={cx("btn btn-sm voice-mute", v.muted && "muted")} onClick={() => room.voice.setMuted(!v.muted)}>
              {v.muted ? <MicOff size={14} /> : <Mic size={14} />} {v.muted ? "Unmute" : "Mute"}
            </button>
          )}
        </div>
      )}
      {on && v.blocked && (
        <button class="voice-blocked" onClick={() => room.voice.unblock()}>
          Your browser is holding back the others' sound. Click here, or anywhere, to hear them.
        </button>
      )}
      {n > 0 && (
        <ul class="voice-people">
          {v.peers.map((p) => (
            <VoicePerson key={p.connId} peer={p} me={p.connId === me?.connId} on={on} />
          ))}
        </ul>
      )}
    </section>
  );
}

function VoicePerson(props: { peer: VoicePeer; me: boolean; on: boolean }) {
  const room = useRoom();
  const { peer, me, on } = props;
  const speaking = useRoomState((s) => s.voice.speaking.includes(peer.connId));
  const link = useRoomState((s) => s.voice.links[peer.connId]);
  const volume = useRoomState((s) => s.voice.volumes[peer.userId] ?? 1);
  return (
    <li class={cx("voice-person", speaking && "speaking")}>
      <span class="voice-avatar" style={{ background: peer.color }}>
        {initial(peer.name)}
      </span>
      <span class="voice-name">
        {peer.name}
        {me && <span class="voice-you"> (you)</span>}
      </span>
      {peer.role === "gm" && <span class="gm-tag">GM</span>}
      {peer.muted && (
        <span class="voice-muted" title="Microphone off">
          <MicOff size={13} aria-label="Microphone off" />
        </span>
      )}
      {on && !me && link === "connecting" && <span class="voice-link">connecting…</span>}
      {on && !me && link === "failed" && (
        <span class="voice-link failed" title="Your networks couldn't find a way through to each other. Leaving voice and joining again may help.">
          can't connect
        </span>
      )}
      {on && !me && canSetVolume() && (
        <input
          type="range"
          class="voice-volume"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          aria-label={`${peer.name}'s volume`}
          title={`${peer.name}'s volume: ${Math.round(volume * 100)}%`}
          onInput={(e) => room.voice.setVolume(peer.userId, Number(e.currentTarget.value) / 100)}
        />
      )}
    </li>
  );
}

/** Push to talk's button: talks while it's held. */
function TalkButton() {
  const room = useRoom();
  const talking = useRoomState((s) => s.voice.talking);
  const key = useRoomState((s) => keyName(s.voice.talkKey));
  return (
    <button class={cx("btn btn-sm voice-talk", talking && "talking")} {...holdToTalk(room)}>
      {talking ? <Mic size={14} /> : <MicOff size={14} />} {talking ? "Talking" : `Hold to talk (${key})`}
    </button>
  );
}

/** Push to talk's key, and a button to choose another: the next key pressed (Esc keeps the old one). */
function KeyPicker() {
  const room = useRoom();
  const key = useRoomState((s) => keyName(s.voice.talkKey));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Caps Lock (on and off on some computers) isn't taken: keep waiting for another key.
      if (e.code !== "Escape" && !usableTalkKey(e.code)) return;
      if (e.code !== "Escape") room.voice.setTalkKey(e.code);
      setPicking(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picking]);
  return (
    <span class="voice-key">
      {picking ? "Press a key (Esc to cancel)" : <>Key: <kbd>{key}</kbd></>}
      {!picking && (
        <button class="link-btn" onClick={() => setPicking(true)}>
          Change
        </button>
      )}
    </span>
  );
}

/** In the zoom box while in voice chat: push to talk's button, or the mute button. */
export function VoiceMicButton() {
  const room = useRoom();
  const on = useRoomState((s) => s.voice.status === "on");
  const mode = useRoomState((s) => voiceMode(s.voice, s.me?.role === "gm"));
  const muted = useRoomState((s) => s.voice.muted);
  const talking = useRoomState((s) => s.voice.talking);
  const key = useRoomState((s) => keyName(s.voice.talkKey));
  if (!on) return null;
  if (mode === "ptt") {
    return (
      <button
        class={cx("tool voice-mic", talking && "talking")}
        title={`Hold to talk (or hold ${key})`}
        aria-label="Hold to talk"
        aria-pressed={talking}
        {...holdToTalk(room)}
      >
        {talking ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
    );
  }
  return (
    <button
      class={cx("tool voice-mic", muted ? "muted" : "live")}
      title={muted ? "Unmute your microphone" : "Mute your microphone"}
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={() => room.voice.setMuted(!muted)}
    >
      {muted ? <MicOff size={18} /> : <Mic size={18} />}
    </button>
  );
}

/** Over the map while the browser holds back the others' sound: any click on the page plays it. */
export function VoiceHeldNotice() {
  const room = useRoom();
  const held = useRoomState((s) => s.voice.status === "on" && s.voice.blocked);
  if (!held) return null;
  return (
    <button class="voice-held" onClick={() => room.voice.unblock()}>
      <VolumeX size={16} /> Your browser is holding back voice chat's sound. Click here, or anywhere, to hear it.
    </button>
  );
}

/** What the overlay keeps clear of: a tool's bar, and the season note on a narrow screen. */
const OBSTACLES = ".tool-options, .board-season-note.shown";

/**
 * Moves the overlay down below anything at the top of the map it would cover. Checked as
 * it changes and a few times a second while it's showing (bars open and change height).
 */
function useClearOfBars(ref: { current: HTMLDivElement | null }, shown: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const area = el?.parentElement;
    if (!shown || !el || !area) return;
    const place = () => {
      const a = area.getBoundingClientRect();
      const right = a.right - (parseFloat(getComputedStyle(el).right) || 0);
      const left = right - el.offsetWidth;
      let top = 10;
      const bars = [...area.querySelectorAll<HTMLElement>(OBSTACLES)]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.right > left && r.left < right)
        .sort((p, q) => p.top - q.top);
      for (const r of bars) if (r.top - a.top < top + el.offsetHeight) top = Math.max(top, r.bottom - a.top + 8);
      el.style.top = `${Math.round(top)}px`;
    };
    place();
    const timer = setInterval(place, 250);
    return () => clearInterval(timer);
  });
}

/** Over the map, while in voice chat: whoever is talking right now, in the order they joined. */
export function SpeakingOverlay() {
  const on = useRoomState((s) => s.voice.status === "on");
  const speaking = useRoomState((s) => s.voice.speaking);
  const peers = useRoomState((s) => s.voice.peers);
  const myId = useRoomState((s) => s.me?.connId);
  const ref = useRef<HTMLDivElement>(null);
  const list = on ? peers.filter((p) => speaking.includes(p.connId)) : [];
  useClearOfBars(ref, list.length > 0);
  if (!list.length) return null;
  return (
    <div class="speaking-overlay" aria-hidden="true" ref={ref}>
      {list.map((p) => (
        <div key={p.connId} class="speaking-chip" style={{ borderColor: p.color }}>
          <span class="voice-avatar" style={{ background: p.color }}>
            {initial(p.name)}
          </span>
          <span class="speaking-name">{p.connId === myId ? "You" : p.name}</span>
          <span class="speaking-bars">
            <i />
            <i />
            <i />
          </span>
        </div>
      ))}
    </div>
  );
}
