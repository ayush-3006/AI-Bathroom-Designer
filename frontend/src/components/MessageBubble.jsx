import BundleCard from "./BundleCard.jsx";

export default function MessageBubble({ role, content, bundle }) {
  return (
    <>
      <div className={`bubble ${role}`}>{content}</div>
      {bundle && <BundleCard bundle={bundle} />}
    </>
  );
}
