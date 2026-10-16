const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/angiang_solar',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize Database Tables
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

  CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      service_type VARCHAR(255) NOT NULL,
      description TEXT,
      unit VARCHAR(50) DEFAULT 'Gói',
      price NUMERIC(15,2) DEFAULT 0,
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
`).then(() => console.log("Database tables verified/created.")).catch(err => console.error("DB Init Error:", err));

const upload = multer({ storage: multer.memoryStorage() });

// --- API ENDPOINTS ---

// 1. Solar Products
app.get('/api/solar-products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM solar_products ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM solar_products WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Materials
app.get('/api/materials', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM materials ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM materials WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// 3. Equipment
app.get('/api/equipment', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM equipment ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM equipment WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Customers
app.get('/api/customers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { name, address, link, status } = req.body;
    const result = await pool.query(
      `INSERT INTO customers (name, address, link, status) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, address, link, status || 'Hoạt động']
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- BỔ SUNG API ĐĂNG NHẬP ---
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Kiểm tra tài khoản khởi tạo mặc định
    if (username === 'admin' && password === '123456') {
      return res.json({ success: true, message: 'Đăng nhập thành công', role: 'Super Admin' });
    }

    // Kiểm tra trong cơ sở dữ liệu bảng admins
    const result = await pool.query('SELECT * FROM admins WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length > 0) {
      res.json({ success: true, message: 'Đăng nhập thành công', role: result.rows[0].role });
    } else {
      res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, link, status } = req.body;
    const result = await pool.query(
      `UPDATE customers SET name=$1, address=$2, link=$3, status=$4 WHERE id=$5 RETURNING *`,
      [name, address, link, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Services
app.get('/api/services', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM services ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM services WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Sales
app.get('/api/sales', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sales ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// 7. Expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM expenses ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Admins (Quản lý tài khoản quản trị)
app.get('/api/admins', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, full_name, role, created_at FROM admins ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  try {
    await pool.query('DELETE FROM admins WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Export Reports
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
});
