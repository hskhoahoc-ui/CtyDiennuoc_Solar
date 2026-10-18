const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:6543/angiang_solar',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize Database Tables & Safe Migrations
pool.query(`
  CREATE TABLE IF NOT EXISTS solar_products (
      id SERIAL PRIMARY KEY,
      image_url TEXT,
      brand VARCHAR(255) NOT NULL,
      power VARCHAR(100),
      category VARCHAR(255),
      catalog_link TEXT,
      stock INTEGER DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'Tấm',
      import_price NUMERIC(15,2) DEFAULT 0,
      selling_price NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS materials (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(255),
      stock INTEGER DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'Kg',
      import_price NUMERIC(15,2) DEFAULT 0,
      selling_price NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS equipment (
      id SERIAL PRIMARY KEY,
      image_url TEXT,
      brand VARCHAR(255) NOT NULL,
      power VARCHAR(100),
      category VARCHAR(255),
      catalog_link TEXT,
      stock INTEGER DEFAULT 0,
      unit VARCHAR(50) DEFAULT 'Bộ',
      import_price NUMERIC(15,2) DEFAULT 0,
      selling_price NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      link TEXT,
      status VARCHAR(50) DEFAULT 'Hoạt động',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      service_type VARCHAR(255) NOT NULL,
      description TEXT,
      unit VARCHAR(50) DEFAULT 'Gói',
      price NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS package_quotations (
      id SERIAL PRIMARY KEY,
      image_url TEXT,
      package_name VARCHAR(255) NOT NULL,
      power VARCHAR(100),
      battery_warranty VARCHAR(100),
      inverter_warranty VARCHAR(100),
      accu_warranty VARCHAR(100),
      package_price NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chatbot_leads (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(255),
      phone VARCHAR(50),
      chat_content TEXT,
      status VARCHAR(50) DEFAULT 'Chưa tư vấn',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quotations (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE,
      power_kw VARCHAR(100),
      customer_name VARCHAR(255),
      items JSONB,
      install_cost NUMERIC(15,2) DEFAULT 0,
      design_cost NUMERIC(15,2) DEFAULT 0,
      total_amount NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      invoice_code VARCHAR(50) UNIQUE,
      customer_name VARCHAR(255),
      phone VARCHAR(50),
      address TEXT,
      content TEXT,
      items JSONB,
      total_amount NUMERIC(15,2) DEFAULT 0,
      total_import_cost NUMERIC(15,2) DEFAULT 0,
      profit NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(255),
      content TEXT,
      cost NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'Quản trị viên',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => console.log("Database tables verified/created successfully.")).catch(err => console.error("DB Init Error:", err));

const upload = multer({ storage: multer.memoryStorage() });

// --- HÀM KIỂM TRA TRẠNG THÁI LINK AN TOÀN ---
async function checkCustomerLinkStatus(url) {
  if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url.trim(), { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return res.ok || (res.status >= 200 && res.status < 400);
  } catch (e) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url.trim(), { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      return res.ok || (res.status >= 200 && res.status < 400);
    } catch (err) {
      return false;
    }
  }
}

async function pingAllCustomerLinks() {
  try {
    const result = await pool.query('SELECT id, link, is_online FROM customers WHERE link IS NOT NULL AND link != \'\'');
    for (let c of result.rows) {
      const currentOnlineStatus = await checkCustomerLinkStatus(c.link);
      const now = new Date();
      if (c.is_online === null || c.is_online !== currentOnlineStatus) {
        await pool.query(
          'UPDATE customers SET is_online = $1, last_status_change = $2, last_checked = $2 WHERE id = $3',
          [currentOnlineStatus, now, c.id]
        );
      } else {
        await pool.query(
          'UPDATE customers SET last_checked = $1 WHERE id = $2',
          [now, c.id]
        );
      }
    }
  } catch (err) {
    console.error("Error pinging customer links:", err.message);
  }
}

setInterval(pingAllCustomerLinks, 3 * 60 * 1000);

// --- API CHATBOT GEMINI & TỰ ĐỘNG LƯU VÀO CHATBOT_LEADS ---
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Tin nhắn không được để trống.' });
        }

        // Tự động kiểm tra và lọc SĐT trong tin nhắn
        const phoneRegex = /(0[3|5|7|8|9])+([0-9]{8})\b/g;
        const matchedPhones = message.match(phoneRegex);
        const phoneStr = (matchedPhones && matchedPhones.length > 0) ? matchedPhones[0] : 'Chưa có SĐT';
        const custName = phoneStr !== 'Chưa có SĐT' ? `Khách hàng (${phoneStr})` : `Khách vãng lai`;

        // Lưu lịch sử chat vào bảng chatbot_leads để hiển thị đúng ở tab Hỗ Trợ Khách Hàng
        await pool.query(
            `INSERT INTO chatbot_leads (customer_name, phone, chat_content, status) VALUES ($1, $2, $3, $4)`,
            [custName, phoneStr, message, 'Chưa tư vấn']
        );

        // Lấy dữ liệu từ Database làm ngữ cảnh cho AI Gemini
        const [pkgRes, prodRes, equipRes, servRes] = await Promise.all([
            pool.query('SELECT * FROM package_quotations'),
            pool.query('SELECT brand, power, selling_price, stock FROM solar_products'),
            pool.query('SELECT brand, power, selling_price FROM equipment'),
            pool.query('SELECT service_type, price, description FROM services')
        ]);

        const packagesText = pkgRes.rows.map(p => `- ${p.package_name} (${p.power}): Giá ${Number(p.package_price).toLocaleString()} VNĐ, BH Pin: ${p.battery_warranty}`).join('\n');
        const productsText = prodRes.rows.map(p => `- Pin ${p.brand} ${p.power}: ${Number(p.selling_price).toLocaleString()} VNĐ (Tồn kho: ${p.stock})`).join('\n');
        const equipmentText = equipRes.rows.map(e => `- Thiết bị ${e.brand} ${e.power}: ${Number(e.selling_price).toLocaleString()} VNĐ`).join('\n');
        const servicesText = servRes.rows.map(s => `- ${s.service_type}: ${Number(s.price).toLocaleString()} VNĐ (${s.description || ''})`).join('\n');

        const SYSTEM_CONTEXT = `
Bạn là Trợ lý ảo AI chuyên nghiệp của CÔNG TY CP ĐIỆN NƯỚC AN GIANG (POWACO).
Thông tin liên hệ: SĐT/Hotline: 0296 3603 382, Địa chỉ: 821 Trần Hưng Đạo, P. Bình Đức, Tỉnh An Giang.

Dữ liệu sản phẩm, dịch vụ và bảng giá trọn gói thực tế hiện có của công ty:
[BÁO GIÁ TRỌN GÓI]:
${packagesText || 'Chưa cập nhật'}

[PIN NĂNG LƯỢNG MẶT TRỜI]:
${productsText || 'Chưa cập nhật'}

[THIẾT BỊ / INVERTER]:
${equipmentText || 'Chưa cập nhật'}

[DỊCH VỤ]:
${servicesText || 'Chưa cập nhật'}

Nhiệm vụ:
1. Trả lời lịch sự, thân thiện, chính xác dựa trên dữ liệu trên bằng tiếng Việt.
2. Khéo léo yêu cầu khách hàng cung cấp Họ tên và Số điện thoại nếu họ muốn có kỹ thuật viên liên hệ khảo sát tận nơi.
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                ...(history || []),
                { role: 'user', parts: [{ text: message }] }
            ],
            config: {
                systemInstruction: SYSTEM_CONTEXT,
                temperature: 0.7,
            }
        });

        res.json({ reply: response.text });
    } catch (error) {
        console.error('Lỗi Gemini API:', error);
        res.status(500).json({ error: 'Hệ thống đang bận. Vui lòng thử lại sau hoặc gọi Hotline 0296 3603 382.' });
    }
});

// --- API QUẢN LÝ CHATBOT LEADS (TAB HỖ TRỢ KHÁCH HÀNG) ---
app.get('/api/chatbot-leads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chatbot_leads ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/chatbot-leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE chatbot_leads SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/chatbot-leads/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM chatbot_leads WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CÁC API CRUD QUẢN TRỊ KHÁC ---

app.get('/api/solar-products', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM solar_products ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/solar-products', async (req, res) => {
  try {
    const { image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `INSERT INTO solar_products (image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [image_url, brand, power, category, catalog_link, stock || 0, unit || 'Tấm', import_price || 0, selling_price || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/solar-products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `UPDATE solar_products SET image_url=$1, brand=$2, power=$3, category=$4, catalog_link=$5, stock=$6, unit=$7, import_price=$8, selling_price=$9 WHERE id=$10 RETURNING *`,
      [image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/solar-products/:id', async (req, res) => {
  try { await pool.query('DELETE FROM solar_products WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/materials', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM materials ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/materials', async (req, res) => {
  try {
    const { name, category, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `INSERT INTO materials (name, category, stock, unit, import_price, selling_price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, category, stock || 0, unit || 'Kg', import_price || 0, selling_price || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/materials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `UPDATE materials SET name=$1, category=$2, stock=$3, unit=$4, import_price=$5, selling_price=$6 WHERE id=$7 RETURNING *`,
      [name, category, stock, unit, import_price, selling_price, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/materials/:id', async (req, res) => {
  try { await pool.query('DELETE FROM materials WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/materials/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa tải lên file xlsx' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    for (let r of rows) {
      const name = r['Tên vật tư'] || r['name'] || 'Vật tư mới';
      const category = r['Loại vật tư'] || r['category'] || 'Chung';
      const stock = parseInt(r['Số lượng'] || r['stock'] || 10);
      const unit = r['Đơn vị tính'] || r['unit'] || 'Kg';
      const import_price = parseFloat(r['Giá nhập'] || r['import_price'] || 0);
      const selling_price = parseFloat(r['Giá bán'] || r['selling_price'] || 0);
      
      await pool.query(
        `INSERT INTO materials (name, category, stock, unit, import_price, selling_price) VALUES ($1, $2, $3, $4, $5, $6)`,
        [name, category, stock, unit, import_price, selling_price]
      );
    }
    res.json({ success: true, count: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/equipment', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM equipment ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/equipment', async (req, res) => {
  try {
    const { image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `INSERT INTO equipment (image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [image_url, brand, power, category, catalog_link, stock || 0, unit || 'Bộ', import_price || 0, selling_price || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/equipment/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price } = req.body;
    const result = await pool.query(
      `UPDATE equipment SET image_url=$1, brand=$2, power=$3, category=$4, catalog_link=$5, stock=$6, unit=$7, import_price=$8, selling_price=$9 WHERE id=$10 RETURNING *`,
      [image_url, brand, power, category, catalog_link, stock, unit, import_price, selling_price, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/equipment/:id', async (req, res) => {
  try { await pool.query('DELETE FROM equipment WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/customers', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM customers ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { name, address, link, status } = req.body;
    let isOnlineState = false;
    try { if (link && link.trim()) { isOnlineState = await checkCustomerLinkStatus(link); } } catch (e) { isOnlineState = false; }
    const now = new Date();

    const result = await pool.query(
      `INSERT INTO customers (name, address, link, status, is_online, last_status_change, last_checked) 
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
      [name, address, link || '', status || 'Hoạt động', isOnlineState, now]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, link, status } = req.body;
    let isOnlineState = false;
    try { if (link && link.trim()) { isOnlineState = await checkCustomerLinkStatus(link); } } catch (e) { isOnlineState = false; }
    const now = new Date();

    const result = await pool.query(
      `UPDATE customers SET name=$1, address=$2, link=$3, status=$4, is_online=$5, last_status_change=$6, last_checked=$6 WHERE id=$7 RETURNING *`,
      [name, address, link || '', status || 'Hoạt động', isOnlineState, now, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/customers/:id', async (req, res) => {
  try { await pool.query('DELETE FROM customers WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/package-quotations', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM package_quotations ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/package-quotations', async (req, res) => {
  try {
    const { image_url, package_name, power, battery_warranty, inverter_warranty, accu_warranty, package_price } = req.body;
    const result = await pool.query(
      `INSERT INTO package_quotations (image_url, package_name, power, battery_warranty, inverter_warranty, accu_warranty, package_price) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [image_url, package_name, power, battery_warranty, inverter_warranty, accu_warranty, package_price || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/package-quotations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { image_url, package_name, power, battery_warranty, inverter_warranty, accu_warranty, package_price } = req.body;
    const result = await pool.query(
      `UPDATE package_quotations SET image_url=$1, package_name=$2, power=$3, battery_warranty=$4, inverter_warranty=$5, accu_warranty=$6, package_price=$7 WHERE id=$8 RETURNING *`,
      [image_url, package_name, power, battery_warranty, inverter_warranty, accu_warranty, package_price, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/package-quotations/:id', async (req, res) => {
  try { await pool.query('DELETE FROM package_quotations WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123456') {
      return res.json({ success: true, message: 'Đăng nhập thành công', role: 'Super Admin' });
    }
    const result = await pool.query('SELECT * FROM admins WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length > 0) {
      res.json({ success: true, message: 'Đăng nhập thành công', role: result.rows[0].role });
    } else {
      res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/services', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM services ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/services', async (req, res) => {
  try {
    const { service_type, description, unit, price } = req.body;
    const result = await pool.query(
      `INSERT INTO services (service_type, description, unit, price) VALUES ($1, $2, $3, $4) RETURNING *`,
      [service_type, description, unit || 'Gói', price || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/services/:id', async (req, res) => {
  try { await pool.query('DELETE FROM services WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sales', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM sales ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sales', async (req, res) => {
  try {
    const { invoice_code, customer_name, phone, address, content, items, total_amount, total_import_cost, profit } = req.body;
    for (let item of items) {
      if (item.type === 'product') {
        await pool.query('UPDATE solar_products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.id]);
      } else if (item.type === 'material') {
        await pool.query('UPDATE materials SET stock = stock - $1 WHERE id = $2', [item.quantity, item.id]);
      } else if (item.type === 'equipment') {
        await pool.query('UPDATE equipment SET stock = stock - $1 WHERE id = $2', [item.quantity, item.id]);
      }
    }
    const result = await pool.query(
      `INSERT INTO sales (invoice_code, customer_name, phone, address, content, items, total_amount, total_import_cost, profit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [invoice_code, customer_name, phone, address, content, JSON.stringify(items), total_amount, total_import_cost, profit]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/expenses', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM expenses ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { customer_name, content, cost } = req.body;
    const result = await pool.query(
      `INSERT INTO expenses (customer_name, content, cost) VALUES ($1, $2, $3) RETURNING *`,
      [customer_name, content, cost || 0]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try { await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admins', async (req, res) => {
  try { const result = await pool.query('SELECT id, username, full_name, role, created_at FROM admins ORDER BY id DESC'); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admins', async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;
    const result = await pool.query(
      `INSERT INTO admins (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role`,
      [username, password || '123456', full_name, role || 'Quản trị viên']
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, full_name, role } = req.body;
    let query = `UPDATE admins SET username=$1, full_name=$2, role=$3`;
    let params = [username, full_name, role, id];
    if (password && password.trim() !== '') {
      query = `UPDATE admins SET username=$1, full_name=$2, role=$3, password=$4 WHERE id=$5`;
      params = [username, full_name, role, password, id];
    } else {
      query += ` WHERE id=$4`;
    }
    await pool.query(query, params);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admins/:id', async (req, res) => {
  try { await pool.query('DELETE FROM admins WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/inventory-report', async (req, res) => {
  try {
    const pRes = await pool.query('SELECT * FROM solar_products');
    const mRes = await pool.query('SELECT * FROM materials');
    const eRes = await pool.query('SELECT * FROM equipment');

    const wb = XLSX.utils.book_new();
    const pData = pRes.rows.map(r => ({ 'Mã': r.id, 'Thương hiệu': r.brand, 'Công suất': r.power, 'Chủng loại': r.category, 'Tồn kho': r.stock, 'ĐVT': r.unit, 'Giá nhập': r.import_price, 'Giá bán': r.selling_price }));
    const mData = mRes.rows.map(r => ({ 'Mã': r.id, 'Tên vật tư': r.name, 'Loại': r.category, 'Tồn kho': r.stock, 'ĐVT': r.unit, 'Giá nhập': r.import_price, 'Giá bán': r.selling_price }));
    const eData = eRes.rows.map(r => ({ 'Mã': r.id, 'Thương hiệu': r.brand, 'Công suất': r.power, 'Chủng loại': r.category, 'Tồn kho': r.stock, 'ĐVT': r.unit, 'Giá nhập': r.import_price, 'Giá bán': r.selling_price }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pData), 'Pin NLMT');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mData), 'Vật tư');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eData), 'Thiết bị');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="BaoCaoTonKho.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/revenue-report', async (req, res) => {
  try {
    const salesRes = await pool.query('SELECT * FROM sales');
    const expRes = await pool.query('SELECT * FROM expenses');

    let totalRev = 0, totalImp = 0, totalExp = 0;
    const sData = salesRes.rows.map(r => {
      totalRev += parseFloat(r.total_amount || 0);
      totalImp += parseFloat(r.total_import_cost || 0);
      return {
        'Mã Khách Hàng': 'KH-' + r.id,
        'Thời Gian Xuất': r.created_at,
        'Họ Tên Khách Hàng': r.customer_name,
        'Nội Dung Xuất': r.content,
        'Địa Chỉ': r.address,
        'Số Tiền (Doanh Thu)': r.total_amount,
        'Giá Vốn Nhập': r.total_import_cost,
        'Lợi Nhuận': r.profit
      };
    });

    const eData = expRes.rows.map(r => {
      totalExp += parseFloat(r.cost || 0);
      return {
        'Tên Khách Hàng / Nội Dung': r.customer_name,
        'Nội Dung Chi Phí': r.content,
        'Chi Phí': r.cost,
        'Thời Gian': r.created_at
      };
    });

    const summaryData = [{
      'Tổng Doanh Thu': totalRev,
      'Tổng Vốn Nhập': totalImp,
      'Tổng Chi Phí': totalExp,
      'Lợi Nhuận Thuần': totalRev - totalImp - totalExp
    }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Tổng quan tài chính');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sData), 'Chi tiết phiếu xuất');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eData), 'Chi phí vận hành');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="BaoCaoDoanhThu_LoiNhuan.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  pingAllCustomerLinks();
});
