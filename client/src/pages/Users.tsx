import ResourcePage, { FieldDef, fetchRefOptions } from "../ResourcePage";
import { Badge } from "../ui";
import { useAuth } from "../store";
import { get, post } from "../api";

const fields: FieldDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "password", label: "Password (set / change)", hideInTable: true },
  { key: "phone", label: "Phone" },
  { key: "roleId", label: "Role", type: "select", required: true, options: async () => (await get<any>("/roles")).map((r: any) => ({ value: r.id, label: r.name })) },
  { key: "branchId", label: "Branch", type: "select", options: () => fetchRefOptions("/branches") },
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

export default function Users() {
  const { can } = useAuth();
  return (
    <ResourcePage
      title="Users"
      endpoint="/users"
      fields={fields}
      canManage={can("users.manage")}
      searchPlaceholder="Name or email…"
    />
  );
}

export async function quickCreateUser(body: any) {
  return post("/users", body);
}
