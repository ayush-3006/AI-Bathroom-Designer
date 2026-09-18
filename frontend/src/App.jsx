import { useState } from "react";
import ChatPanel from "./components/ChatPanel.jsx";
import LayoutCanvas from "./components/LayoutCanvas.jsx";

export default function App() {
  const [slots, setSlots] = useState({ widthFt: null, lengthFt: null, showerWidthFt: null, showerLengthFt: null });
  const [bundle, setBundle] = useState(null);

  return (
    <div className="split">
      <ChatPanel
        onSlots={(s) =>
          setSlots({
            widthFt: s.widthFt,
            lengthFt: s.lengthFt,
            showerWidthFt: s.showerWidthFt,
            showerLengthFt: s.showerLengthFt,
          })
        }
        onBundle={setBundle}
        onReset={() => {
          setSlots({ widthFt: null, lengthFt: null, showerWidthFt: null, showerLengthFt: null });
          setBundle(null);
        }}
      />
      <LayoutCanvas
        widthFt={slots.widthFt}
        lengthFt={slots.lengthFt}
        showerWidthFt={slots.showerWidthFt}
        showerLengthFt={slots.showerLengthFt}
        bundle={bundle}
      />
    </div>
  );
}
