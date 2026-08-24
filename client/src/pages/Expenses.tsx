import ResourcePage, { FieldDef, fetchRefOptions } from "../ResourcePage";
import { money, dateFmt } from "../format";
import { useAuth } from "../store";

const fields: FieldDef[] = [
  { key: "categoryId", label: "Category", type: "select", required: true, options: () => fetchRefOptions("/expenses/categories") },
  { key: "amount", label: "Amount", type: "number", step: "0.01", required: true, render: (r) => <b>{money(r.amount)}</b> },
  {
    key: "method",
    label: "Method",
    type: "select",
    default: "cash",
    options: [
      { value: "cash", label: "Cash" },
      { value: "upi", label: "UPI" },
      { value: "card", label: "Card" },
      { value: "bank", label: "Bank" },
    ],
  },
  { key: "date", label: "Date", type: "date", render: (r) => dateFmt(r.date) },
  { key: "description", label: "Description", type: "textarea" },
];

export default function Expenses() {
  const { can } = useAuth();
  return <ResourcePage title="Expenses" endpoint="/expenses" fields={fields} canManage={can("expenses.manage")} searchPlaceholder="Search description…" />;
}
