export default function BundleCard({ bundle }) {
  if (!bundle) return null;
  const roles = Object.entries(bundle.roles);

  return (
    <div className="bundle-card">
      <h3>Recommended bundle</h3>
      {roles.map(([role, item]) => (
        <div className="bundle-row" key={role}>
          <span className="role">
            {role}: {item.name || item.collection}
            {item.finish_color || item.finish ? ` (${item.finish_color || item.finish})` : ""}
          </span>
          <span className="price">₹{item.price_inr.toLocaleString("en-IN")}</span>
        </div>
      ))}
      <div className="bundle-total">
        <span>Total</span>
        <span className="price">₹{bundle.total.toLocaleString("en-IN")}</span>
      </div>
    </div>
  );
}
