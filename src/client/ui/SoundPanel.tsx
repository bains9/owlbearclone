// Sound (the top bar): what's playing for everyone. The GM adds it from the list chosen for them, sets
// how loud each is, and can hear one alone before the table does; everyone has their own volume.
import { useEffect, useRef, useState } from "preact/hooks";
import { Headphones, Square, Volume2, VolumeX, X } from "lucide-preact";
import { MAX_SOUNDS, SOUNDS, SOUND_GROUPS, soundOption, withSound, withoutSound, type RoomSounds, type SoundOption } from "../../shared/sounds";
import { previewSound, setRoomSounds, setSoundLevelHere, setSoundMuted, setSoundVolume, soundState, subscribeSound, unlockSound } from "../soundscape";
import { useVoiceHeld } from "./VoicePanel";
import { cx, useRoom, useRoomState } from "./common";

function useSound() {
  const [, redraw] = useState(0);
  useEffect(() => subscribeSound(() => redraw((n) => n + 1)), []);
  return soundState();
}

const NONE: RoomSounds = {};
const useRoomSounds = () => useRoomState((s) => s.room?.settings.sounds ?? NONE);

/**
 * Plays what the room has on, whichever panel is open. Not on a table display: there's nobody at it to
 * click it or turn it down, and a game round a table has the GM's own device to play it from.
 */
export function SoundHost() {
  const room = useRoom();
  const sounds = useRoomSounds();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const told = useRef(false);
  const key = JSON.stringify(sounds);
  useEffect(() => {
    if (room.display) return;
    setRoomSounds(sounds);
    if (!gm && !told.current && Object.keys(sounds).length && !soundState().muted) {
      told.current = true;
      room.toast("The GM has put on background sound. Sound, in the top bar or under More, has your own volume.");
    }
  }, [key]);
  useEffect(
    () => () => {
      setRoomSounds({});
      previewSound(null);
    },
    [],
  );
  return null;
}

/** Over the map while the browser holds the sound back: any click on the page plays it. */
export function SoundHeldNotice() {
  const { held } = useSound();
  // One notice is enough: the same click starts both (and they'd lie on top of each other).
  const voiceHeld = useVoiceHeld();
  if (!held || voiceHeld) return null;
  return (
    <button class="voice-held" onClick={unlockSound}>
      <VolumeX size={16} /> Your browser is holding back the table's background sound. Click here, or anywhere, to hear it.
    </button>
  );
}

function YourVolume() {
  const { volume, muted } = useSound();
  return (
    <div class="sound-volume">
      <button
        class={cx("icon-btn", muted && "active")}
        title={muted ? "Turn background sound back on, on this device" : "Turn background sound off, on this device"}
        aria-label={muted ? "Turn background sound back on" : "Turn background sound off"}
        aria-pressed={muted}
        onClick={() => setSoundMuted(!muted)}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <label class="sound-slider">
        <span class="small">Your volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Your volume"
          onInput={(e) => setSoundVolume(Number((e.target as HTMLInputElement).value))}
        />
      </label>
    </div>
  );
}

function PlayingRow(props: { id: string; level: number; gm: boolean; sounds: RoomSounds }) {
  const room = useRoom();
  const { id, gm, sounds } = props;
  const name = soundOption(id)?.name ?? id;
  const [level, setLevel] = useState(props.level);
  useEffect(() => setLevel(props.level), [props.level]);
  return (
    <li class="sound-row sound-playing">
      <span class="sound-name">{name}</span>
      {gm && (
        <>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={level}
            title={`How loud ${name} is for everyone`}
            aria-label={`How loud ${name} is for everyone`}
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setLevel(v);
              setSoundLevelHere(id, v);
            }}
            onChange={(e) => room.updateRoom({ settings: { sounds: withSound(sounds, id, Number((e.target as HTMLInputElement).value)) } })}
          />
          <button
            class="icon-btn"
            title={`Stop ${name} for everyone`}
            aria-label={`Stop ${name}`}
            onClick={() => room.updateRoom({ settings: { sounds: withoutSound(sounds, id) } })}
          >
            <X size={16} />
          </button>
        </>
      )}
    </li>
  );
}

function OptionRow(props: { option: SoundOption; sounds: RoomSounds; preview: string | null }) {
  const room = useRoom();
  const { option, sounds, preview } = props;
  const count = Object.keys(sounds).length;
  const playing = option.id in sounds;
  const hearing = preview === option.id;
  const add = (next: RoomSounds) => {
    // Started in the click: Safari plays only that.
    unlockSound();
    previewSound(null);
    room.updateRoom({ settings: { sounds: next } });
  };
  return (
    <li class="sound-row">
      <div class="sound-about">
        <span class="sound-name">{option.name}</span>
        <span class="small muted">{option.blurb}</span>
      </div>
      <button
        class={cx("icon-btn", hearing && "active")}
        title={hearing ? "Stop listening" : "Hear it: only you, nobody else at the table"}
        aria-label={hearing ? `Stop listening to ${option.name}` : `Hear ${option.name}, only you`}
        aria-pressed={hearing}
        onClick={() => previewSound(hearing ? null : option.id)}
      >
        <Headphones size={16} />
      </button>
      {playing ? (
        <span class="small muted sound-on">Playing</span>
      ) : (
        <div class="sound-buttons">
          {count > 0 && (
            <button class="btn btn-sm" title={`Everyone hears ${option.name} in place of what's playing`} onClick={() => add({ [option.id]: 1 })}>
              Switch
            </button>
          )}
          <button
            class="btn btn-sm btn-primary"
            disabled={count >= MAX_SOUNDS}
            title={count >= MAX_SOUNDS ? `${MAX_SOUNDS} at once is the most: stop one first` : count ? `Everyone hears ${option.name} as well as what's playing` : `Everyone hears ${option.name}`}
            onClick={() => add(withSound(sounds, option.id))}
          >
            Add
          </button>
        </div>
      )}
    </li>
  );
}

export function SoundPanel() {
  const room = useRoom();
  const gm = useRoomState((s) => s.me?.role === "gm");
  const sounds = useRoomSounds();
  const { preview, muted } = useSound();
  const on = Object.entries(sounds);
  // Listening stops with the panel closed, so it can't be left running by mistake.
  useEffect(() => () => previewSound(null), []);
  return (
    <div class="panel-body sound-panel">
      <YourVolume />
      {muted && <p class="small muted">Off on this device, whatever the GM puts on.</p>}
      <div class="sound-head">
        <h3>Playing for everyone</h3>
        {gm && on.length > 0 && (
          <button class="btn btn-sm" onClick={() => room.updateRoom({ settings: { sounds: {} } })}>
            <Square size={13} /> Stop all
          </button>
        )}
      </div>
      {on.length ? (
        <ul class="sound-list">
          {on.map(([id, level]) => (
            <PlayingRow key={id} id={id} level={level} gm={gm} sounds={sounds} />
          ))}
        </ul>
      ) : (
        <p class="small muted">{gm ? "Nothing yet. Add one below and everyone hears it." : "Nothing at the moment. Sound the GM puts on plays here, at your own volume."}</p>
      )}
      {gm &&
        SOUND_GROUPS.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <ul class="sound-list">
              {SOUNDS.filter((s) => s.group === group).map((option) => (
                <OptionRow key={option.id} option={option} sounds={sounds} preview={preview} />
              ))}
            </ul>
          </section>
        ))}
      <p class="small muted">Today's rain and wind have their own button, in the Calendar panel.</p>
    </div>
  );
}
