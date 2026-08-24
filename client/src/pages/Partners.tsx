import ResourcePage, { FieldDef } from "../ResourcePage";
import { money } from "../format";
import { Badge } from "../ui";
import { useAuth } from "../store";

const statusField = (label: string): FieldDef => ({
  key: "status",
  label,
  type: "select",
  default: "active",
  options: [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ],
  render: (r) => <Badge color={r.status === "active" ? "green" : "slate"}>{r.status}</Badge>,
});

export function Customers() {
  const { can } = useAuth();
  const fields: FieldDef[] = [
    { key: "name", label: "Name", required: true },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", hideInTable: true },
    { key: "address", label: "Address", hideInTable: true, type: "textarea" },
    { key: "gstNumber", label: "GST number", hideInTable: true },
    { key: "openingBalance", label: "Opening balance", type: "number", step: "0.01", hideInTable: true },
    { key: "creditLimit", label: "Credit limit", type: "number", step: "0.01", hideInTable: true },
    { key: "loyaltyPoints", label: "Loyalty pts", hideInForm: true },
    { key: "balance", label: "Balance", hideInForm: true, render: (r) => money(r.balance ?? 0) },
    statusField("Status"),
  ];
  return <ResourcePage title="Customers" endpoint="/customers" fields={fields} canManage={can("customers.manage")} searchPlaceholder="Name / phone…" />;
}

export function Suppliers() {
  const { can } = useAuth();
  const fields: FieldDef[] = [
    { key: "name", label: "Name", required: true },
    { key: "company", label: "Company" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email", hideInTable: true },
    { key: "address", label: "Address", hideInTable: true, type: "textarea" },
    { key: "gstNumber", label: "GST number", hideInTable: true },
    { key: "paymentTerms", label: "Payment terms", hideInTable: true },
    { key: "openingBalance", label: "Opening balance", type: "number", step: "0.01", hideInTable: true },
    statusField("Status"),
  ];
  return <ResourcePage title="Suppliers" endpoint="/suppliers" fields={fields} canManage={can("suppliers.manage")} searchPlaceholder="Name / company / phone…" />;
}
