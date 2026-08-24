import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const r2 = (n: number) => Math.round(n * 100) / 100;

function daysAgo(n: number, hour = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, intBetween(0, 59), intBetween(0, 59), 0);
  return d;
}

async function main() {
  console.log("Seeding database...");

  // ============ CLEANUP (idempotent re-seed) ============
  await prisma.rolePermission.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.backup.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.discount.deleteMany();
  await prisma.loyaltyPoint.deleteMany();
  await prisma.customerPayment.deleteMany();
  await prisma.customerTransaction.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.supplierTransaction.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesReturnItem.deleteMany();
  await prisma.salesReturn.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.salePayment.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.purchasePayment.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.productBatch.deleteMany();
  await prisma.serialNumber.deleteMany();
  await prisma.stockTransferItem.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.taxRate.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.cashTransaction.deleteMany();
  await prisma.cashRegister.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.setting.deleteMany();

  // ============ PERMISSIONS ============
  const perms: { key: string; name: string; module: string }[] = [
    { key: "dashboard.view", name: "View Dashboard", module: "Dashboard" },
    { key: "pos.access", name: "Use POS", module: "POS" },
    { key: "pos.discount", name: "Apply POS Discounts", module: "POS" },
    { key: "pos.hold", name: "Hold / Resume Bills", module: "POS" },
    { key: "pos.cancel", name: "Cancel Bills", module: "POS" },
    { key: "products.view", name: "View Products", module: "Products" },
    { key: "products.create", name: "Create Products", module: "Products" },
    { key: "products.edit", name: "Edit Products", module: "Products" },
    { key: "products.delete", name: "Delete Products", module: "Products" },
    { key: "products.import", name: "Import Products", module: "Products" },
    { key: "products.export", name: "Export Products", module: "Products" },
    { key: "products.price_update", name: "Bulk Price Update", module: "Products" },
    { key: "categories.manage", name: "Manage Categories", module: "Catalog" },
    { key: "brands.manage", name: "Manage Brands", module: "Catalog" },
    { key: "units.manage", name: "Manage Units", module: "Catalog" },
    { key: "taxrates.manage", name: "Manage Tax Rates", module: "Catalog" },
    { key: "customers.view", name: "View Customers", module: "Customers" },
    { key: "customers.create", name: "Create Customers", module: "Customers" },
    { key: "customers.edit", name: "Edit Customers", module: "Customers" },
    { key: "customers.delete", name: "Delete Customers", module: "Customers" },
    { key: "customers.credit", name: "Credit Sales", module: "Customers" },
    { key: "suppliers.view", name: "View Suppliers", module: "Suppliers" },
    { key: "suppliers.create", name: "Create Suppliers", module: "Suppliers" },
    { key: "suppliers.edit", name: "Edit Suppliers", module: "Suppliers" },
    { key: "suppliers.delete", name: "Delete Suppliers", module: "Suppliers" },
    { key: "purchases.view", name: "View Purchases", module: "Purchases" },
    { key: "purchases.create", name: "Create Purchases", module: "Purchases" },
    { key: "purchases.edit", name: "Edit Purchases", module: "Purchases" },
    { key: "purchases.delete", name: "Delete Purchases", module: "Purchases" },
    { key: "purchases.receive", name: "Receive Purchases", module: "Purchases" },
    { key: "purchases.pay", name: "Record Supplier Payments", module: "Purchases" },
    { key: "purchases.return", name: "Purchase Returns", module: "Purchases" },
    { key: "sales.view", name: "View Sales", module: "Sales" },
    { key: "sales.create", name: "Create Sales", module: "Sales" },
    { key: "sales.edit", name: "Edit Sales", module: "Sales" },
    { key: "sales.delete", name: "Delete Sales", module: "Sales" },
    { key: "sales.cancel", name: "Cancel Sales", module: "Sales" },
    { key: "sales.refund", name: "Refund Sales", module: "Sales" },
    { key: "sales.discount", name: "Apply Sales Discounts", module: "Sales" },
    { key: "sales.export", name: "Export Sales", module: "Sales" },
    { key: "sales.print", name: "Print / Email Invoices", module: "Sales" },
    { key: "returns.view", name: "View Returns", module: "Returns" },
    { key: "returns.create", name: "Create Returns", module: "Returns" },
    { key: "inventory.view", name: "View Inventory", module: "Inventory" },
    { key: "inventory.adjust", name: "Stock Adjustments", module: "Inventory" },
    { key: "inventory.transfer", name: "Stock Transfers", module: "Inventory" },
    { key: "inventory.manage", name: "Manage Inventory", module: "Inventory" },
    { key: "expenses.view", name: "View Expenses", module: "Expenses" },
    { key: "expenses.create", name: "Create Expenses", module: "Expenses" },
    { key: "expenses.edit", name: "Edit Expenses", module: "Expenses" },
    { key: "expenses.delete", name: "Delete Expenses", module: "Expenses" },
    { key: "cash.view", name: "View Cash", module: "Cash" },
    { key: "cash.open", name: "Open Cash Register", module: "Cash" },
    { key: "cash.close", name: "Close Cash Register", module: "Cash" },
    { key: "shifts.view", name: "View Shifts", module: "Shifts" },
    { key: "shifts.manage", name: "Manage Shifts", module: "Shifts" },
    { key: "employees.view", name: "View Employees", module: "Employees" },
    { key: "employees.manage", name: "Manage Employees", module: "Employees" },
    { key: "users.view", name: "View Users", module: "Users" },
    { key: "users.manage", name: "Manage Users", module: "Users" },
    { key: "roles.view", name: "View Roles", module: "Roles" },
    { key: "roles.manage", name: "Manage Roles", module: "Roles" },
    { key: "reports.view", name: "View Reports", module: "Reports" },
    { key: "reports.export", name: "Export Reports", module: "Reports" },
    { key: "settings.view", name: "View Settings", module: "Settings" },
    { key: "settings.manage", name: "Manage Settings", module: "Settings" },
    { key: "backups.manage", name: "Manage Backups", module: "Backups" },
    { key: "audit.view", name: "View Audit Logs", module: "Audit" },
    { key: "notifications.view", name: "View Notifications", module: "Notifications" },
    { key: "branches.manage", name: "Manage Branches", module: "Branches" },
    { key: "coupons.manage", name: "Manage Coupons", module: "Marketing" },
    { key: "discounts.manage", name: "Manage Discounts", module: "Marketing" },
  ];

  const ALL = perms.map((p) => p.key);
  const NONE: string[] = [];
  const roleMatrix: Record<string, string[]> = {
    "Super Admin": ALL,
    "Admin": ALL.filter((k) => !["backups.manage", "branches.manage", "roles.manage"].includes(k)),
    "Manager": [
      "dashboard.view", "pos.access", "pos.discount", "pos.hold", "pos.cancel",
      "products.view", "products.create", "products.edit", "products.export", "products.price_update",
      "categories.manage", "brands.manage", "units.manage", "taxrates.manage",
      "customers.view", "customers.create", "customers.edit", "customers.credit",
      "suppliers.view", "suppliers.create", "suppliers.edit",
      "purchases.view", "purchases.create", "purchases.receive", "purchases.pay", "purchases.return",
      "sales.view", "sales.create", "sales.export", "sales.print",
      "returns.view", "returns.create",
      "inventory.view", "inventory.adjust", "inventory.transfer",
      "expenses.view", "expenses.create",
      "cash.view", "cash.open", "cash.close",
      "shifts.view", "shifts.manage",
      "employees.view",
      "reports.view", "reports.export",
      "notifications.view",
      "discounts.manage",
    ],
    "Cashier": [
      "dashboard.view", "pos.access", "pos.hold",
      "sales.view", "sales.create", "sales.print",
      "customers.view", "customers.create",
      "cash.view", "cash.open", "cash.close",
      "notifications.view",
    ],
    "Storekeeper": [
      "dashboard.view",
      "products.view", "products.create", "products.edit",
      "categories.manage", "brands.manage", "units.manage",
      "suppliers.view",
      "purchases.view", "purchases.create", "purchases.receive",
      "inventory.view", "inventory.adjust", "inventory.transfer", "inventory.manage",
      "reports.view",
      "notifications.view",
    ],
    "Accountant": [
      "dashboard.view",
      "sales.view", "sales.export",
      "purchases.view",
      "expenses.view", "expenses.create", "expenses.edit", "expenses.delete",
      "cash.view",
      "customers.view", "suppliers.view",
      "reports.view", "reports.export",
      "notifications.view",
    ],
  };

  await prisma.permission.createMany({ data: perms });
  const permByKey = new Map<string, string>();
  for (const p of await prisma.permission.findMany()) permByKey.set(p.key, p.id);

  // ============ ROLES ============
  const roles: Record<string, string> = {};
  for (const [name, keys] of Object.entries(roleMatrix)) {
    const role = await prisma.role.create({
      data: {
        name,
        isSystem: true,
        description: `System role: ${name}`,
        permissions: {
          create: keys.map((key) => ({ permissionId: permByKey.get(key)! })),
        },
      },
    });
    roles[name] = role.id;
  }

  // ============ BRANCH ============
  const branch = await prisma.branch.create({
    data: {
      name: "Main Store",
      code: "MAIN",
      address: "12, MG Road, Bengaluru, Karnataka 560001",
      phone: "+91 98450 12345",
      email: "store@example.com",
      gstNumber: "29ABCDE1234F1Z5",
    },
  });

  // ============ USERS ============
  const passwordHash = await bcrypt.hash("password123", 10);
  const users: Record<string, string> = {};
  const userDefs: { key: string; name: string; email: string; role: string; phone: string }[] = [
    { key: "superadmin", name: "Super Admin", email: "superadmin@pos.com", role: "Super Admin", phone: "9000000001" },
    { key: "admin", name: "Admin User", email: "admin@pos.com", role: "Admin", phone: "9000000002" },
    { key: "manager", name: "Store Manager", email: "manager@pos.com", role: "Manager", phone: "9000000003" },
    { key: "cashier", name: "Cashier One", email: "cashier@pos.com", role: "Cashier", phone: "9000000004" },
    { key: "cashier2", name: "Cashier Two", email: "cashier2@pos.com", role: "Cashier", phone: "9000000005" },
    { key: "storekeeper", name: "Store Keeper", email: "storekeeper@pos.com", role: "Storekeeper", phone: "9000000006" },
    { key: "accountant", name: "Accountant", email: "accountant@pos.com", role: "Accountant", phone: "9000000007" },
  ];
  for (const u of userDefs) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        passwordHash,
        phone: u.phone,
        roleId: roles[u.role],
        branchId: branch.id,
      },
    });
    users[u.key] = user.id;
  }

  // ============ CATALOG ============
  const catDefs: { name: string; children: string[] }[] = [
    { name: "Grocery", children: ["Rice & Grains", "Cooking Oil", "Spices", "Flours"] },
    { name: "Beverages", children: ["Soft Drinks", "Juices", "Tea & Coffee", "Water"] },
    { name: "Dairy & Bakery", children: ["Milk & Curd", "Bread", "Butter & Cheese"] },
    { name: "Snacks & Confectionery", children: ["Biscuits", "Chips", "Chocolates", "Namkeen"] },
    { name: "Personal Care", children: ["Soap & Bodywash", "Shampoo", "Oral Care", "Skincare"] },
    { name: "Household", children: ["Detergents", "Cleaners", "Kitchen"] },
    { name: "Electronics", children: ["Mobiles", "Accessories", "Home Appliances"] },
    { name: "Clothing", children: ["Men", "Women", "Kids"] },
    { name: "Pharmacy", children: ["OTC", "Vitamins", "First Aid"] },
    { name: "Stationery", children: ["Writing", "Paper", "Office Supplies"] },
  ];
  const categoryIds: Record<string, string> = {};
  const subcategoryIds: Record<string, string> = {};
  for (const c of catDefs) {
    const cat = await prisma.category.create({ data: { name: c.name } });
    categoryIds[c.name] = cat.id;
    for (const sub of c.children) {
      const s = await prisma.category.create({ data: { name: sub, parentId: cat.id } });
      subcategoryIds[sub] = s.id;
    }
  }

  const brandNames = ["Tata", "Amul", "Parle", "Britannia", "Haldiram's", "Nivea", "Colgate", "Samsung", "Levi's", "Cipla", "ITC", "Nestlé", "P&G", "Dabur", "Tropicana", "Bisleri", "Asian Paints", "Dell", "Sunfeast", "Dettol"];
  const brandIds: Record<string, string> = {};
  for (const b of brandNames) {
    const row = await prisma.brand.create({ data: { name: b } });
    brandIds[b] = row.id;
  }

  const unitDefs = [
    { name: "Piece", shortName: "pcs" },
    { name: "Kilogram", shortName: "kg" },
    { name: "Gram", shortName: "g" },
    { name: "Litre", shortName: "L" },
    { name: "Millilitre", shortName: "ml" },
    { name: "Box", shortName: "box" },
    { name: "Pack", shortName: "pack" },
    { name: "Dozen", shortName: "dz" },
    { name: "Bottle", shortName: "btl" },
    { name: "Meter", shortName: "m" },
  ];
  const unitIds: Record<string, string> = {};
  for (const u of unitDefs) {
    const row = await prisma.unit.create({ data: u });
    unitIds[u.name] = row.id;
  }

  const taxDefs = [
    { name: "GST 0%", rate: 0, cgst: 0, sgst: 0, igst: 0 },
    { name: "GST 5%", rate: 5, cgst: 2.5, sgst: 2.5, igst: 5 },
    { name: "GST 12%", rate: 12, cgst: 6, sgst: 6, igst: 12 },
    { name: "GST 18%", rate: 18, cgst: 9, sgst: 9, igst: 18 },
    { name: "GST 28%", rate: 28, cgst: 14, sgst: 14, igst: 28 },
  ];
  const taxIds: Record<string, string> = {};
  for (const t of taxDefs) {
    const row = await prisma.taxRate.create({ data: { ...t, type: "exclusive" } });
    taxIds[t.rate] = row.id;
  }

  // ============ SUPPLIERS ============
  const supplierNames = [
    "Bharat Foods Distributors", "City Beverages Co", "Fresh Dairy Supplies", "Sunrise Electronics",
    "Global Pharma Traders", "Style Textiles Pvt Ltd", "Home Care Wholesale", "Metro Stationery Mart",
    "Agro Grain Suppliers", "Quick Snacks Imports",
  ];
  const supplierIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const s = await prisma.supplier.create({
      data: {
        name: supplierNames[i],
        company: supplierNames[i],
        phone: `+91 98${intBetween(10000000, 99999999)}`,
        email: `sales@${supplierNames[i].toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
        address: `${intBetween(1, 200)}, Industrial Area, Bengaluru`,
        gstNumber: `29${String.fromCharCode(65 + i)}BCDE${intBetween(1000, 9999)}F1Z5`,
        openingBalance: 0,
        creditLimit: intBetween(5, 20) * 10000,
        paymentTerms: pick(["15 days", "30 days", "Cash on delivery", "45 days"]),
        branchId: branch.id,
      },
    });
    supplierIds.push(s.id);
  }

  // ============ CUSTOMERS ============
  const customerDefs = [
    ["Ramesh Kumar", "9845012345", "14th Cross, Malleshwaram"],
    ["Sneha Reddy", "9845023456", "Jayanagar 4th Block"],
    ["Arjun Nair", "9845034567", "Indiranagar 100ft Road"],
    ["Priya Sharma", "9845045678", "Koramangala 5th Block"],
    ["Vikram Singh", "9845056789", "Whitefield Main Road"],
    ["Anita Desai", "9845067890", "HSR Layout Sector 2"],
    ["Mohammed Imran", "9845078901", "Frazer Town"],
    ["Kavitha Iyer", "9845089012", "Basavanagudi"],
    ["Rahul Verma", "9845090123", "RT Nagar"],
    ["Divya Menon", "9845101234", "Marathahalli"],
    ["Suresh Patil", "9845112345", "Bannerghatta Road"],
    ["Lakshmi Narayan", "9845123456", "Vijayanagar"],
    ["Deepak Joshi", "9845134567", "Kengeri"],
    ["Meera Krishnan", "9845145678", "Yelahanka"],
    ["Naveen Shetty", "9845156789", "Bommanahalli"],
    ["Pooja Gupta", "9845167890", "Hebbal"],
    ["Sanjay Kumar", "9845178901", "Mysore Road"],
    ["Ritu Agarwal", "9845189012", "Sarjapur Road"],
    ["Farhan Khan", "9845190123", "Shivajinagar"],
    ["Geetha Raman", "9845201234", "Padmanabhanagar"],
  ];
  const customerIds: string[] = [];
  for (const [name, phone, address] of customerDefs) {
    const hasCredit = rand() < 0.5;
    const c = await prisma.customer.create({
      data: {
        name,
        phone,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@gmail.com`,
        address,
        gstNumber: rand() < 0.5 ? `29${name.toUpperCase().slice(0, 2)}CU${intBetween(1000, 9999)}Z1A5` : null,
        openingBalance: 0,
        creditLimit: hasCredit ? intBetween(5, 50) * 1000 : 0,
        discountPercent: rand() < 0.3 ? pick([5, 10]) : 0,
        branchId: branch.id,
      },
    });
    customerIds.push(c.id);
  }

  // ============ PRODUCTS ============
  const productDefs: [string, string, string, string, number, number, number, number][] = [
    // name, category, subcategory, brand, purchase, selling, gst, stockFactor
    ["Basmati Rice 5kg", "Grocery", "Rice & Grains", "Tata", 420, 485, 5, 1],
    ["Sunflower Oil 1L", "Grocery", "Cooking Oil", "ITC", 128, 155, 5, 1],
    ["Toor Dal 1kg", "Grocery", "Rice & Grains", "Tata", 145, 175, 5, 1],
    ["Wheat Flour 5kg", "Grocery", "Flours", "Tata", 165, 195, 5, 1],
    ["Turmeric Powder 200g", "Grocery", "Spices", "Dabur", 55, 75, 5, 1],
    ["Chilli Powder 200g", "Grocery", "Spices", "Dabur", 65, 85, 5, 1],
    ["Poha 1kg", "Grocery", "Rice & Grains", "Tata", 55, 70, 5, 1],
    ["Sugar 1kg", "Grocery", "Rice & Grains", "ITC", 45, 55, 5, 1],
    ["Coca-Cola 750ml", "Beverages", "Soft Drinks", "ITC", 34, 45, 18, 1],
    ["Pepsi 750ml", "Beverages", "Soft Drinks", "ITC", 34, 45, 18, 1],
    ["Sprite 750ml", "Beverages", "Soft Drinks", "ITC", 34, 45, 18, 1],
    ["Real Mango Juice 1L", "Beverages", "Juices", "Tropicana", 105, 135, 12, 1],
    ["Tropicana Mixed Fruit 1L", "Beverages", "Juices", "Tropicana", 105, 135, 12, 1],
    ["Bru Instant Coffee 100g", "Beverages", "Tea & Coffee", "ITC", 165, 195, 18, 1],
    ["Tata Tea Gold 500g", "Beverages", "Tea & Coffee", "Tata", 195, 240, 5, 1],
    ["Bisleri Water 1L", "Beverages", "Water", "Bisleri", 14, 20, 18, 1],
    ["Amul Milk 500ml", "Dairy & Bakery", "Milk & Curd", "Amul", 24, 30, 5, 1],
    ["Amul Curd 400g", "Dairy & Bakery", "Milk & Curd", "Amul", 26, 35, 5, 1],
    ["Amul Butter 100g", "Dairy & Bakery", "Butter & Cheese", "Amul", 48, 62, 5, 1],
    ["Amul Cheese Slices 10pcs", "Dairy & Bakery", "Butter & Cheese", "Amul", 95, 120, 12, 1],
    ["Britannia Bread 400g", "Dairy & Bakery", "Bread", "Britannia", 32, 42, 5, 1],
    ["Parle-G Biscuits 250g", "Snacks & Confectionery", "Biscuits", "Parle", 22, 30, 18, 1],
    ["Oreo Biscuits 120g", "Snacks & Confectionery", "Biscuits", "Britannia", 25, 35, 18, 1],
    ["Good Day Biscuits 300g", "Snacks & Confectionery", "Biscuits", "Britannia", 45, 60, 18, 1],
    ["Lay's Chips 52g", "Snacks & Confectionery", "Chips", "ITC", 18, 25, 18, 1],
    ["Kurkure 90g", "Snacks & Confectionery", "Chips", "ITC", 18, 25, 18, 1],
    ["Dairy Milk Silk 80g", "Snacks & Confectionery", "Chocolates", "Nestlé", 68, 90, 18, 1],
    ["KitKat 38g", "Snacks & Confectionery", "Chocolates", "Nestlé", 28, 40, 18, 1],
    ["Haldiram's Aloo Bhujia 200g", "Snacks & Confectionery", "Namkeen", "Haldiram's", 55, 72, 5, 1],
    ["Dove Soap 100g", "Personal Care", "Soap & Bodywash", "P&G", 42, 58, 18, 1],
    ["Lux Soap 100g", "Personal Care", "Soap & Bodywash", "Nivea", 30, 42, 18, 1],
    ["Dettol Soap 125g", "Personal Care", "Soap & Bodywash", "Dettol", 38, 52, 18, 1],
    ["Head & Shoulders 180ml", "Personal Care", "Shampoo", "P&G", 155, 195, 18, 1],
    ["Colgate MaxFresh 100g", "Personal Care", "Oral Care", "Colgate", 65, 85, 18, 1],
    ["Nivea Creme 100ml", "Personal Care", "Skincare", "Nivea", 110, 145, 18, 1],
    ["Tide Detergent 1kg", "Household", "Detergents", "P&G", 95, 125, 18, 1],
    ["Surf Excel 500g", "Household", "Detergents", "P&G", 85, 110, 18, 1],
    ["Lizol Disinfectant 500ml", "Household", "Cleaners", "Dabur", 85, 112, 18, 1],
    ["Vim Dishwash Bar 300g", "Household", "Kitchen", "P&G", 22, 30, 18, 1],
    ["Samsung Mobile Charger", "Electronics", "Accessories", "Samsung", 350, 499, 18, 2],
    ["Samsung USB Cable", "Electronics", "Accessories", "Samsung", 220, 349, 18, 2],
    ["Dell Wireless Mouse", "Electronics", "Accessories", "Dell", 480, 699, 18, 2],
    ["Samsung Earbuds", "Electronics", "Accessories", "Samsung", 950, 1499, 18, 2],
    ["Levi's Men T-Shirt", "Clothing", "Men", "Levi's", 450, 799, 12, 2],
    ["Levi's Jeans Men", "Clothing", "Men", "Levi's", 1250, 1999, 12, 2],
    ["Levi's Ladies Top", "Clothing", "Women", "Levi's", 550, 899, 12, 2],
    ["Kids Denim Jacket", "Clothing", "Kids", "Levi's", 780, 1199, 12, 2],
    ["Cipla Paracetamol 15 tabs", "Pharmacy", "OTC", "Cipla", 18, 28, 12, 1],
    ["Dolo 650 15 tabs", "Pharmacy", "OTC", "Cipla", 28, 42, 12, 1],
    ["B-Complex Capsules 20", "Pharmacy", "Vitamins", "Cipla", 95, 145, 12, 1],
    ["Vitamin C 500mg 30 tabs", "Pharmacy", "Vitamins", "Dabur", 165, 240, 12, 1],
    ["Dettol Antiseptic 250ml", "Pharmacy", "First Aid", "Dettol", 95, 125, 18, 1],
    ["Band-Aid Strip 20s", "Pharmacy", "First Aid", "Dettol", 35, 50, 18, 1],
    ["Reynolds Pen 0.5mm", "Stationery", "Writing", "ITC", 12, 20, 18, 1],
    ["Classmate Notebook 200pg", "Stationery", "Paper", "ITC", 55, 80, 12, 1],
    ["A4 Copy Paper 500 sheets", "Stationery", "Paper", "ITC", 240, 320, 12, 1],
    ["Stapler with Pins", "Stationery", "Office Supplies", "ITC", 85, 129, 12, 1],
    ["Amul Ghee 500ml", "Grocery", "Cooking Oil", "Amul", 260, 320, 12, 1],
    ["Nescafe Classic 100g", "Beverages", "Tea & Coffee", "Nestlé", 195, 240, 18, 1],
  ];

  interface ProductSeed {
    id: string;
    name: string;
    category: string;
    brand: string;
    purchasePrice: number;
    sellingPrice: number;
    taxRate: number;
    minStock: number;
    stock: number;
  }
  const products: ProductSeed[] = [];
  let skuCounter = 1000;
  for (const [name, cat, sub, brand, pp, sp, tax, factor] of productDefs) {
    const code = `P-${skuCounter}`;
    skuCounter++;
    const stock = intBetween(80, 300) * factor;
    const p = await prisma.product.create({
      data: {
        name,
        code,
        sku: `SKU-${code}`,
        barcode: `8901${String(intBetween(1000000, 9999999)).padStart(7, "0")}`,
        categoryId: categoryIds[cat],
        brandId: brandIds[brand],
        unitId: unitIds[cat === "Grocery" || cat === "Pharmacy" || cat === "Snacks & Confectionery" ? "Pack" : cat === "Beverages" || cat === "Household" || cat === "Personal Care" ? "Bottle" : "Piece"],
        taxRateId: taxIds[tax],
        purchasePrice: pp,
        sellingPrice: sp,
        mrp: Math.round(sp * 1.1),
        wholesalePrice: Math.round(pp * 1.08),
        openingStock: stock,
        minStock: intBetween(10, 25),
        maxStock: stock * 2,
        supplierId: pick(supplierIds),
        description: `${name} - ${brand} product`,
        status: "active",
        trackBatch: tax === 12 && rand() < 0.2,
        branchId: branch.id,
      },
    });
    const inv = await prisma.inventory.create({
      data: { productId: p.id, branchId: branch.id, quantity: stock },
    });
    await prisma.stockMovement.create({
      data: { productId: p.id, branchId: branch.id, type: "opening", quantity: stock, prevStock: 0, newStock: stock, userId: users.superadmin, note: "Opening stock" },
    });
    void inv;
    if (rand() < 0.25) {
      await prisma.productVariant.createMany({
        data: [
          { productId: p.id, name: "Small", sku: `SKU-${p.sku}-S`, barcode: `8902${intBetween(1000000, 9999999)}`, sellingPrice: Math.round(sp * 0.8), purchasePrice: Math.round(pp * 0.8), mrp: Math.round(sp * 0.9) },
          { productId: p.id, name: "Large", sku: `SKU-${p.sku}-L`, barcode: `8903${intBetween(1000000, 9999999)}`, sellingPrice: Math.round(sp * 1.2), purchasePrice: Math.round(pp * 1.2), mrp: Math.round(sp * 1.3) },
        ],
      });
      await prisma.product.update({ where: { id: p.id }, data: { hasVariants: true } });
      const variants = await prisma.productVariant.findMany({ where: { productId: p.id } });
      for (const v of variants) {
        await prisma.inventory.create({ data: { productId: p.id, variantId: v.id, branchId: branch.id, quantity: Math.round(stock / 2) } });
      }
    }
    if (rand() < 0.3) {
      const batchNum = `B-${intBetween(1000, 9999)}`;
      const expiry = daysAgo(intBetween(-300, -30));
      await prisma.productBatch.create({
        data: { productId: p.id, batchNumber: batchNum, expiryDate: expiry, quantity: Math.round(stock * 0.4), branchId: branch.id },
      });
    }
    products.push({ id: p.id, name, category: cat, brand, purchasePrice: pp, sellingPrice: sp, taxRate: tax, minStock: 10, stock });
  }

  // ============ PURCHASES (90 days) ============
  const purchaseNos: string[] = [];
  for (let day = 90; day >= 0; day -= intBetween(2, 4)) {
    const count = intBetween(1, 3);
    for (let c = 0; c < count; c++) {
      const itemCount = intBetween(4, 12);
      const items: any[] = [];
      for (let i = 0; i < itemCount; i++) {
        const p = pick(products);
        const qty = intBetween(5, 60);
        const disc = rand() < 0.2 ? r2(p.purchasePrice * qty * between(0.02, 0.05)) : 0;
        const taxAmt = r2(((p.purchasePrice * qty - disc) * p.taxRate) / 100);
        items.push({
          productId: p.id,
          quantity: qty,
          purchasePrice: p.purchasePrice,
          discountAmount: disc,
          taxAmount: taxAmt,
          taxRate: p.taxRate,
          total: r2(p.purchasePrice * qty - disc),
          batchNumber: rand() < 0.3 ? `B-${intBetween(1000, 9999)}` : null,
        });
        p.stock += qty;
      }
      const subtotal = r2(items.reduce((s, i) => s + i.purchasePrice * i.quantity, 0));
      const discount = r2(items.reduce((s, i) => s + i.discountAmount, 0));
      const tax = r2(items.reduce((s, i) => s + i.taxAmount, 0));
      const total = r2(subtotal - discount + tax);
      const paidPct = pick([1, 1, 0.8, 0.5, 0]);
      const paid = r2(total * paidPct);
      const supplier = pick(supplierIds);
      const purchaseNo = `PUR-${String(day).padStart(2, "0")}-${String(intBetween(1000, 9999))}`;
      const status = paidPct === 1 ? "paid" : paidPct === 0 ? "received" : "partially_paid";
      const createdAt = daysAgo(day, intBetween(9, 18));
      const p = await prisma.purchase.create({
        data: {
          purchaseNo,
          invoiceNumber: `SUP-${intBetween(10000, 99999)}`,
          invoiceDate: createdAt,
          supplierId: supplier,
          branchId: branch.id,
          userId: pick([users.manager, users.storekeeper]),
          subtotal,
          discountAmount: discount,
          taxAmount: tax,
          total,
          paidAmount: paid,
          balance: r2(total - paid),
          status,
          paymentStatus: paidPct === 1 ? "paid" : paidPct === 0 ? "unpaid" : "partially_paid",
          note: "Regular stock replenishment",
          receivedAt: createdAt,
          createdAt,
          items: { create: items },
        },
      });
      if (paid > 0) {
        await prisma.purchasePayment.create({
          data: { purchaseId: p.id, method: pick(["cash", "bank", "upi"]), amount: paid, paidAt: createdAt },
        });
      }
      purchaseNos.push(purchaseNo);
    }
  }

  // ============ SALES (90 days) ============
  const paymentMethods = ["cash", "cash", "cash", "upi", "upi", "upi", "card", "card", "bank", "credit"];
  let invoiceCounter = 1000;
  let salesTotal = 0;
  for (let day = 90; day >= 0; day--) {
    const weekday = new Date(daysAgo(day)).getDay();
    const salesCount = weekday === 0 ? intBetween(4, 8) : intBetween(8, 18);
    for (let s = 0; s < salesCount; s++) {
      invoiceCounter++;
      const itemCount = intBetween(1, 6);
      const lineItems: any[] = [];
      for (let i = 0; i < itemCount; i++) {
        const p = pick(products);
        if (p.stock <= 0) continue;
        const qty = intBetween(1, p.stock > 5 ? 4 : 2);
        if (qty > p.stock) continue;
        const price = p.sellingPrice;
        const discPct = rand() < 0.15 ? between(0, 0.1) : 0;
        const disc = r2(price * qty * discPct);
        const tax = p.taxRate;
        const taxAmt = r2(((price * qty - disc) * tax) / 100);
        lineItems.push({
          productId: p.id,
          quantity: qty,
          price,
          costPrice: p.purchasePrice,
          discountAmount: disc,
          taxAmount: taxAmt,
          taxRate: tax,
          total: r2(price * qty - disc),
          returnedQty: 0,
          stockAfter: p.stock,
        });
        p.stock -= qty;
      }
      if (lineItems.length === 0) continue;
      const subtotal = r2(lineItems.reduce((x, i) => x + i.price * i.quantity, 0));
      const discount = r2(lineItems.reduce((x, i) => x + i.discountAmount, 0));
      const tax = r2(lineItems.reduce((x, i) => x + i.taxAmount, 0));
      const gross = subtotal - discount + tax;
      const rounded = Math.round(gross);
      const roundOff = r2(rounded - gross);
      const total = rounded;
      const method = pick(paymentMethods);
      const hasCustomer = rand() < 0.6;
      const customerId = hasCustomer ? pick(customerIds) : null;
      const paid = method === "credit" ? r2(total * (rand() < 0.5 ? 0 : between(0.2, 0.5))) : total;
      const paymentStatus = paid >= total ? "paid" : paid > 0 ? "partial" : "credit";
      const invoiceNo = `INV-${invoiceCounter}`;
      const createdAt = daysAgo(day, intBetween(10, 21));
      const sale = await prisma.sale.create({
        data: {
          invoiceNo,
          customerId,
          branchId: branch.id,
          userId: pick([users.cashier, users.cashier2]),
          subtotal,
          discountAmount: discount,
          taxAmount: tax,
          roundOff,
          total,
          paidAmount: paid,
          balance: r2(total - paid),
          status: "completed",
          paymentStatus,
          note: null,
          createdAt,
          items: {
            create: lineItems.map(({ stockAfter, ...rest }) => rest),
          },
        },
      });
      await prisma.salePayment.create({
        data: { saleId: sale.id, method, amount: paid, receivedAt: createdAt },
      });
      for (const it of lineItems) {
        await prisma.stockMovement.create({
          data: {
            productId: it.productId,
            branchId: branch.id,
            type: "sale",
            quantity: -it.quantity,
            prevStock: it.stockAfter + it.quantity,
            newStock: it.stockAfter,
            userId: sale.userId,
            referenceType: "sale",
            referenceId: sale.id,
            note: `Sale ${invoiceNo}`,
            createdAt,
          },
        });
      }
      await prisma.invoice.create({
        data: {
          invoiceNo,
          saleId: sale.id,
          items: {
            create: lineItems.map((i) => ({
              productId: i.productId,
              productName: products.find((x) => x.id === i.productId)?.name || "Item",
              quantity: i.quantity,
              price: i.price,
              discountAmount: i.discountAmount,
              taxAmount: i.taxAmount,
              total: i.total,
            })),
          },
        },
      });
      salesTotal += total;
      if (customerId) {
        const lastTx = await prisma.customerTransaction.findFirst({ where: { customerId }, orderBy: { date: "desc" } });
        const outstanding = (lastTx?.balanceAfter || 0) + (total - paid);
        await prisma.customerTransaction.create({
          data: { customerId, type: "sale", amount: total, referenceId: sale.id, balanceAfter: r2(outstanding), date: createdAt, note: `Invoice ${invoiceNo}` },
        });
      }
      if (customerId && paid > 0 && rand() < 0.5) {
        await prisma.customerPayment.create({
          data: { customerId, saleId: sale.id, amount: paid, method, date: createdAt, userId: sale.userId },
        });
      }
    }
  }
  console.log(`Seeded ${invoiceCounter - 1000} sales, total ${salesTotal.toFixed(2)}`);

  // ============ SALES RETURNS ============
  const completedSales = await prisma.sale.findMany({
    where: { status: "completed" },
    include: { items: true },
    take: 60,
  });
  for (const sale of completedSales.slice(0, 12)) {
    const item = sale.items[intBetween(0, sale.items.length - 1)];
    if (!item) continue;
    const qty = Math.min(intBetween(1, Math.floor(item.quantity)), item.quantity);
    const amount = r2(qty * item.price);
    const ret = await prisma.salesReturn.create({
      data: {
        returnNo: `SR-${intBetween(1000, 9999)}`,
        saleId: sale.id,
        customerId: sale.customerId,
        branchId: sale.branchId,
        userId: sale.userId,
        subtotal: amount,
        refundAmount: amount,
        reason: pick(["Defective product", "Customer changed mind", "Wrong item", "Expired product"]),
        restocked: true,
        status: "completed",
        createdAt: daysAgo(intBetween(1, 30)),
      },
    });
    await prisma.salesReturnItem.create({
      data: {
        returnId: ret.id,
        saleItemId: item.id,
        productId: item.productId,
        quantity: qty,
        price: item.price,
        amount,
        reason: ret.reason,
      },
    });
    await prisma.saleItem.update({ where: { id: item.id }, data: { returnedQty: { increment: qty } } });
  }

  // ============ EXPENSES ============
  const expenseCategories = ["Rent", "Electricity", "Salary", "Internet", "Transport", "Maintenance", "Miscellaneous"];
  const expenseCatIds: Record<string, string> = {};
  for (const name of expenseCategories) {
    const row = await prisma.expenseCategory.create({ data: { name } });
    expenseCatIds[name] = row.id;
  }
  for (let i = 0; i < 45; i++) {
    const cat = pick(expenseCategories);
    const amount = cat === "Rent" ? 25000 : cat === "Salary" ? intBetween(15, 40) * 1000 : intBetween(200, 8000);
    await prisma.expense.create({
      data: {
        categoryId: expenseCatIds[cat],
        amount,
        method: cat === "Rent" || cat === "Salary" ? "bank" : pick(["cash", "cash", "upi"]),
        date: daysAgo(intBetween(0, 89), intBetween(9, 20)),
        description: `${cat} - ${pick(["Monthly", "Weekly", "One-time", "Repair", "Bill payment"])} expense`,
        branchId: branch.id,
        userId: pick([users.admin, users.accountant]),
      },
    });
  }

  // ============ CASH REGISTERS & SHIFTS ============
  for (let day = 6; day >= 1; day--) {
    const d = daysAgo(day, 9);
    const end = daysAgo(day, 21);
    const salesCash = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM(sp.amount), 0) as total FROM SalePayment sp JOIN Sale s ON s.id = sp.saleId WHERE sp.method = 'cash' AND sp.receivedAt >= ? AND sp.receivedAt <= ?`,
      d, end
    );
    const expensesCash = await prisma.$queryRawUnsafe<{ total: number }[]>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM Expense WHERE method = 'cash' AND date >= ? AND date <= ?`, d, end
    );
    const opening = intBetween(3000, 8000);
    const expected = r2(opening + Number(salesCash[0]?.total || 0) - Number(expensesCash[0]?.total || 0));
    const actual = r2(expected + (rand() < 0.4 ? between(-50, 80) : 0));
    const reg = await prisma.cashRegister.create({
      data: {
        branchId: branch.id,
        userId: users.cashier,
        date: d,
        openingCash: opening,
        cashSales: Number(salesCash[0]?.total || 0),
        cashExpenses: Number(expensesCash[0]?.total || 0),
        expectedCash: expected,
        actualCash: actual,
        difference: r2(actual - expected),
        status: "closed",
        openedBy: users.cashier,
        closedBy: users.cashier,
        closedAt: end,
      },
    });
    await prisma.cashTransaction.create({ data: { registerId: reg.id, type: "opening", amount: opening, note: "Opening cash", userId: users.cashier } });
    await prisma.shift.create({
      data: {
        userId: users.cashier,
        branchId: branch.id,
        openedAt: d,
        closedAt: end,
        openingCash: opening,
        expectedCash: expected,
        actualCash: actual,
        difference: r2(actual - expected),
        status: "closed",
      },
    });
  }
  const todayOpen = await prisma.cashRegister.create({
    data: { branchId: branch.id, userId: users.cashier, date: daysAgo(0, 9), openingCash: 5000, status: "open", openedBy: users.cashier },
  });
  await prisma.cashTransaction.create({ data: { registerId: todayOpen.id, type: "opening", amount: 5000, note: "Opening cash", userId: users.cashier } });
  await prisma.shift.create({
    data: { userId: users.cashier, branchId: branch.id, openedAt: daysAgo(0, 9), openingCash: 5000, status: "open" },
  });

  // ============ SETTINGS ============
  const settings: Record<string, string> = {
    "company.name": "Shree Traders",
    "company.address": "12, MG Road, Bengaluru, Karnataka 560001",
    "company.phone": "+91 98450 12345",
    "company.email": "store@example.com",
    "company.gst": "29ABCDE1234F1Z5",
    "company.currency": "₹",
    "company.tagline": "Your one-stop shop",
    "company.logo": "",
    "invoice.terms": "Goods once sold cannot be taken back. Warranty as per manufacturer.",
    "invoice.footer": "Thank you for shopping with us!",
    "invoice.prefix": "INV",
    "invoice.digits": "5",
    "tax.type": "exclusive",
    "tax.cgst": "9",
    "tax.sgst": "9",
    "pos.maxDiscountPercent": "50",
    "pos.printerWidth": "80",
    "pos.showBarcode": "true",
    "printer.type": "thermal",
    "printer.width": "80",
    "printer.copies": "1",
    "whatsapp.defaultMessage": "Hello {customer}, your invoice {invoice} total {total}. Thank you!",
    "email.smtpEnabled": "false",
    "email.from": "store@example.com",
    "email.smtpHost": "",
    "email.smtpPort": "587",
    "email.smtpUser": "",
    "email.smtpPass": "",
    "loyalty.enabled": "true",
    "loyalty.pointsPerAmount": "100",
    "loyalty.pointValue": "1",
    "loyalty.pointsExpiryDays": "365",
    "backup.automatic": "false",
    "backup.intervalHours": "24",
    "notify.lowStock": "true",
    "notify.expiry": "true",
    "notify.payments": "true",
  };
  for (const [k, v] of Object.entries(settings)) {
    await prisma.setting.create({ data: { key: k, value: v, group: "general" } });
  }

  // ============ COUPONS & DISCOUNTS ============
  await prisma.coupon.createMany({
    data: [
      { code: "SAVE10", type: "percent", value: 10, minAmount: 500, maxDiscount: 200, usageLimit: 100, validFrom: daysAgo(30), validTo: daysAgo(-60), status: "active" },
      { code: "WELCOME100", type: "fixed", value: 100, minAmount: 1000, usageLimit: 50, validFrom: daysAgo(20), validTo: daysAgo(-90), status: "active" },
      { code: "FESTIVE15", type: "percent", value: 15, minAmount: 1500, maxDiscount: 500, usageLimit: 200, validFrom: daysAgo(10), validTo: daysAgo(-30), status: "active" },
    ],
  });
  await prisma.discount.createMany({
    data: [
      { name: "Festival sale - electronics 10%", type: "category", value: 10, valueType: "percent", appliesTo: "Electronics", validFrom: daysAgo(10), validTo: daysAgo(-30), status: "active" },
      { name: "Bulk customer discount", type: "customer", value: 5, valueType: "percent", validFrom: daysAgo(60), validTo: daysAgo(-60), status: "active" },
    ],
  });

  // ============ AUDIT LOG ============
  await prisma.auditLog.create({
    data: {
      userId: users.superadmin,
      action: "SEED_DATABASE",
      module: "system",
      entityType: "database",
      details: JSON.stringify({ sales: invoiceCounter - 1000, products: productDefs.length }),
    },
  });

  // ============ NOTIFICATIONS ============
  const lowStockCandidates = await prisma.product.findMany({
    where: { status: "active" },
    include: { inventories: { where: { branchId: branch.id } } },
    take: 300,
  });
  const lowStockProducts = lowStockCandidates
    .filter((p) => {
      const q = p.inventories.reduce((s, i) => s + i.quantity, 0);
      return q > 0 && q <= p.minStock;
    })
    .slice(0, 5);
  for (const p of lowStockProducts) {
    await prisma.notification.create({
      data: {
        type: "low_stock",
        title: "Low stock alert",
        message: `${p.name} is running low (${p.inventories[0]?.quantity || 0} left)`,
        link: "/inventory",
      },
    });
  }

  console.log("Seeding complete!");
  console.log("Demo accounts (password: password123):");
  console.log("  superadmin@pos.com / admin@pos.com / manager@pos.com / cashier@pos.com / storekeeper@pos.com / accountant@pos.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());