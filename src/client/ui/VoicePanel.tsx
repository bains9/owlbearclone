// Voice chat's controls: its part of the Chat & dice panel, the microphone button in the
// zoom box, and the overlay on the map showing who's talking.

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Headphones, Lock, Mic, MicOff, PhoneOff, VolumeX } from "lucide-preact";
import type { VoicePeer } from "../../shared/voice";
import { keyName, usableTalkKey, voiceMode } from "../room/voice";
import type { VoiceState } from "../room/voice";
import { voiceLink } from "../room/voiceLink";
import { useStore } from "../store";
import { cx } from "./common";

/** A slice of the table's voice chat state; re-renders when it changes. */
function useVoice<T>(select: (v: VoiceState) => T): T {
  return useStore(voiceLink.store, select);
}
const voice = voiceLink.voice;

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
function holdToTalk(): JSX.HTMLAttributes<HTMLButtonElement> {
  const stop = () => voice.setTalking(false);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      voice.setTalking(true);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onContextMenu: (e) => e.preventDefault(),
    onKeyDown: (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (!e.repeat) voice.setTalking(true);
    },
    onKeyUp: (e) => {
      if (e.key === " " || e.key === "Enter") stop();
    },
    onBlur: stop,
  };
}

/** Voice chat at the top of the Chat & dice panel. */
export function VoiceSection() {
  const v = useVoice((s) => s);
  const me = v.self;
  const gm = v.role === "gm";
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
          <button class="btn btn-primary btn-sm voice-join" onClick={() => void voice.join()}>
            <Mic size={14} /> Join voice
          </button>
        )}
        {v.status === "starting" && (
          <button class="btn btn-sm voice-leave" onClick={() => voice.leave()}>
            Cancel
          </button>
        )}
        {on && (
          <button class="btn btn-sm voice-leave" onClick={() => voice.leave()}>
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
              onChange={(e) => voice.setMode(e.currentTarget.checked ? "ptt" : "open")}
            />
            Push to talk
          </label>
          {mode === "ptt" && <KeyPicker />}
          {mode === "ptt" ? (
            <TalkButton />
          ) : (
            <button class={cx("btn btn-sm voice-mute", v.muted && "muted")} onClick={() => voice.setMuted(!v.muted)}>
              {v.muted ? <MicOff size={14} /> : <Mic size={14} />} {v.muted ? "Unmute" : "Mute"}
            </button>
          )}
        </div>
      )}
      {on && v.blocked && (
        <button class="voice-blocked" onClick={() => voice.unblock()}>
          Your browser is holding back the others' sound. Click here, or anywhere, to hear them.
        </button>
      )}
      {on && v.whisperTo && (
        <div class="voice-whisper-note">
          <Lock size={14} aria-hidden="true" />
          <span>
            {v.peers.some((p) => p.userId === v.whisperTo?.userId)
              ? `Whispering to ${v.whisperTo.name}: only they hear you.`
              : `${v.whisperTo.name} left voice chat, so nobody hears you.`}
          </span>
          <button class="btn btn-sm" onClick={() => voice.whisper(null)}>
            Talk to everyone
          </button>
        </div>
      )}
      {n > 0 && (
        <ul class="voice-people">
          {v.peers.map((p) => (
            <VoicePerson key={p.connId} peer={p} me={p.connId === me?.connId} on={on} mine={p.userId === myUserId(v)} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** This tab's person in voice chat (by userId), once the server has it in. */
function myUserId(v: VoiceState): string | null {
  return v.peers.find((p) => p.connId === v.self?.connId)?.userId ?? null;
}

function VoicePerson(props: { peer: VoicePeer; me: boolean; on: boolean; mine: boolean }) {
  const { peer, me, on, mine } = props;
  const speaking = useVoice((s) => s.speaking.includes(peer.connId));
  const link = useVoice((s) => s.links[peer.connId]);
  const volume = useVoice((s) => s.volumes[peer.userId] ?? 1);
  const toThem = useVoice((s) => s.whisperTo?.userId === peer.userId);
  const toMe = useVoice((s) => s.whisperFrom.includes(peer.connId));
  // Your own row while whispering: the others see your microphone as off, but it isn't.
  const meWhispering = useVoice((s) => me && !!s.whisperTo);
  return (
    <li class={cx("voice-person", speaking && "speaking", (toThem || toMe) && "whisper")}>
      <span class="voice-avatar" style={{ background: peer.color }}>
        {initial(peer.name)}
      </span>
      <span class="voice-name">
        {peer.name}
        {me && <span class="voice-you"> (you)</span>}
      </span>
      {peer.role === "gm" && <span class="gm-tag">GM</span>}
      {toMe && (
        <span class="voice-whisper-tag" title="Only you hear them">
          <Lock size={11} aria-hidden="true" /> whispering to you
        </span>
      )}
      {/* Someone whispering to you shows as muted to everyone, you included: you hear them anyway. */}
      {peer.muted && !toMe && !meWhispering && (
        <span class="voice-muted" title="Microphone off">
          <MicOff size={13} aria-label="Microphone off" />
        </span>
      )}
      {on && !mine && (
        <button
          class={cx("link-btn voice-whisper", toThem && "active")}
          aria-pressed={toThem}
          title={toThem ? "Talk to everyone again" : `Only ${peer.name} hears you, and nobody else can tell`}
          onClick={() => voice.whisper(toThem ? null : peer.userId)}
        >
          {toThem ? "Stop" : "Whisper"}
        </button>
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
          onInput={(e) => voice.setVolume(peer.userId, Number(e.currentTarget.value) / 100)}
        />
      )}
    </li>
  );
}

/** Push to talk's button: talks while it's held. */
function TalkButton() {
  const talking = useVoice((s) => s.talking);
  const key = useVoice((s) => keyName(s.talkKey));
  const whisper = useVoice((s) => !!s.whisperTo);
  const idle = whisper ? `Hold to whisper (${key})` : `Hold to talk (${key})`;
  return (
    <button class={cx("btn btn-sm voice-talk", talking && "talking")} {...holdToTalk()}>
      {talking ? <Mic size={14} /> : <MicOff size={14} />} {talking ? (whisper ? "Whispering" : "Talking") : idle}
    </button>
  );
}

/** Push to talk's key, and a button to choose another: the next key pressed (Esc keeps the old one). */
function KeyPicker() {
  const key = useVoice((s) => keyName(s.talkKey));
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      // Caps Lock (on and off on some computers) isn't taken: keep waiting for another key.
      if (e.code !== "Escape" && !usableTalkKey(e.code)) return;
      if (e.code !== "Escape") voice.setTalkKey(e.code);
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
  const on = useVoice((s) => s.status === "on");
  const mode = useVoice((s) => voiceMode(s, s.role === "gm"));
  const muted = useVoice((s) => s.muted);
  const talking = useVoice((s) => s.talking);
  const key = useVoice((s) => keyName(s.talkKey));
  const to = useVoice((s) => s.whisperTo?.name);
  if (!on) return null;
  if (mode === "ptt") {
    return (
      <button
        class={cx("tool voice-mic", talking && "talking", to && "whisper")}
        title={to ? `Hold to whisper to ${to} (or hold ${key})` : `Hold to talk (or hold ${key})`}
        aria-label="Hold to talk"
        aria-pressed={talking}
        {...holdToTalk()}
      >
        {talking ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
    );
  }
  return (
    <button
      class={cx("tool voice-mic", muted ? "muted" : "live", to && "whisper")}
      title={muted ? "Unmute your microphone" : to ? `Whispering to ${to}: mute your microphone` : "Mute your microphone"}
      aria-label={muted ? "Unmute" : "Mute"}
      onClick={() => voice.setMuted(!muted)}
    >
      {muted ? <MicOff size={18} /> : <Mic size={18} />}
    </button>
  );
}

/** Whether the browser is holding back the others' voices. */
export function useVoiceHeld(): boolean {
  return useVoice((s) => s.status === "on" && s.blocked);
}

/** Over the map while the browser holds back the others' sound: any click on the page plays it. */
export function VoiceHeldNotice() {
  const held = useVoiceHeld();
  if (!held) return null;
  return (
    <button class="voice-held" onClick={() => voice.unblock()}>
      <VolumeX size={16} /> Your browser is holding back voice chat's sound. Click here, or anywhere, to hear it.
    </button>
  );
}

/** Over the map, while in voice chat: whoever is talking right now, in the order they joined. */
export function SpeakingOverlay() {
  const on = useVoice((s) => s.status === "on");
  const speaking = useVoice((s) => s.speaking);
  const peers = useVoice((s) => s.peers);
  const myId = useVoice((s) => s.self?.connId);
  const to = useVoice((s) => s.whisperTo?.name);
  const from = useVoice((s) => s.whisperFrom);
  const list = on ? peers.filter((p) => speaking.includes(p.connId)) : [];
  if (!list.length) return null;
  // A whisper says so, on the whisperer's map and the one whispered to: nobody else sees it.
  const label = (p: VoicePeer) => {
    if (p.connId === myId) return to ? `You, to ${to}` : "You";
    return from.includes(p.connId) ? `${p.name}, to you` : p.name;
  };
  return (
    <div class="speaking-overlay" aria-hidden="true">
      {list.map((p) => (
        <div key={p.connId} class={cx("speaking-chip", (from.includes(p.connId) || (p.connId === myId && to)) && "whisper")} style={{ borderColor: p.color }}>
          <span class="voice-avatar" style={{ background: p.color }}>
            {initial(p.name)}
          </span>
          <span class="speaking-name">{label(p)}</span>
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
