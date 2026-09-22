import { useState } from "react";

import { applySettings, sfx } from "../lib/audio";
import { settings, useSettings, type Settings as Prefs } from "../lib/settings";
import { requestTilt, setSteering, tiltSupported } from "../lib/tilt";
import { sendToUnity } from "../lib/unity";
import { Sheet } from "../components/ui";

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className={`toggle-row ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <i />
    </button>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const prefs = useSettings();
  const [tiltError, setTiltError] = useState<string | null>(null);

  const update = (patch: Partial<Prefs>) => {
    settings.set(patch);
    applySettings();
    sfx.click();
  };

  const chooseSteering = async (mode: Prefs["steering"]) => {
    setTiltError(null);
    if (mode === "tilt" && !(await requestTilt())) {
      setTiltError("Motion access was refused, so tilt steering is unavailable.");
      return;
    }
    update({ steering: mode });
    setSteering(mode);
  };

  return (
    <div className="screen settings">
      <div className="spacer" />
      <Sheet title="Settings" onClose={onClose}>
        <p className="eyebrow">Steering</p>
        <div className="segmented">
          <button className={prefs.steering === "touch" ? "active" : ""} onClick={() => chooseSteering("touch")}>
            Touch
          </button>
          <button
            className={prefs.steering === "tilt" ? "active" : ""}
            onClick={() => chooseSteering("tilt")}
            disabled={!tiltSupported()}
          >
            Tilt
          </button>
        </div>
        <p className="muted small">
          {prefs.steering === "tilt"
            ? "Tilt the phone to steer. Touch anywhere to brake; keep touching through a corner to drift."
            : "Hold the left or right half to steer. While holding, add your other thumb to drift — release for a boost."}
        </p>
        {tiltError && <p className="error small">{tiltError}</p>}

        <p className="eyebrow">Sound and feel</p>
        <Toggle label="Sound effects" on={prefs.sound} onChange={(sound) => update({ sound })} />
        <Toggle label="Music" on={prefs.music} onChange={(music) => update({ music })} />
        <Toggle label="Vibration" on={prefs.haptics} onChange={(haptics) => update({ haptics })} />
        <Toggle
          label="Glow effects"
          hint="Turn off if the game feels slow on your phone"
          on={prefs.effects}
          onChange={(effects) => {
            update({ effects });
            sendToUnity("SetBloom", effects ? "1" : "0");
          }}
        />
      </Sheet>
    </div>
  );
}
