import ResourcePage, { FieldDef, fetchRefOptions } from "../ResourcePage";
import { money } from "../format";
import { Badge } from "../ui";
import { useAuth } from "../store";

const fields: FieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "code", label: "Code" },
  { key: "categoryId", label: "Category", type: "select", hideInTable: true, options: () => fetchRefOptions("/catalog/categories") },
  { key: "brandId", label: "Brand", type: "select", hideInTable: true, options: () => fetchRefOptions("/catalog/brands") },
  { key: "unitId", label: "Unit", type: "select", hideInTable: true, options: () => fetchRefOptions("/catalog/units") },
  { key: "taxRateId", label: "Tax rate", type: "select", hideInTable: true, options: () => fetchRefOptions("/catalog/tax-rates") },
  { key: "purchasePrice", label: "Purchase price", type: "number", step: "0.01" },
  { key: "sellingPrice", label: "Selling price", type: "number", step: "0.01", render: (r) => <b>{money(r.sellingPrice)}</b> },
  { key: "mrp", label: "MRP", type: "number", step: "0.01", hideInTable: true },
  { key: "wholesalePrice", label: "Wholesale price", type: "number", step: "0.01", hideInTable: true },
  { key: "minStock", label: "Min stock", type: "number" },
  {
    key: "status",
    label: "Status",
    type: "select",
    default: "active",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
    render: (r) => <Badge color={r.status === "active" ? "green" : "slate"}>{r.status}</Badge>,
  },
];

export default function Products() {
  const { can } = useAuth();
  return (
    <ResourcePage
      title="Products"
      endpoint="/products"
      fields={fields}
      canManage={can("products.manage")}
      searchPlaceholder="Search name / SKU / barcode…"
    />
  );
}
