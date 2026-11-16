# Xếp giờ HIS

App xếp giờ thủ thuật và điền vào màn "Quản lý phẫu thuật thủ thuật" của VNPT HIS.

- Tải bản mới nhất: vào mục Releases, lấy file `XepGioHIS.zip`, giải nén, bấm đúp `XepGioHIS.exe`.
- Hướng dẫn dùng: `app/Huong-dan.html` (có sẵn trong gói).
- Máy đã có app sẽ tự lấy bản mới mỗi lần mở, theo `app/version.json`.

Thư mục `app/nguon` là mã nguồn. `his-mo-phong.html` là bản mô phỏng với số liệu giả, đồng thời là nguồn của bộ xếp giờ. Phát hành bản mới: `node app/nguon/phat-hanh.js --day`.

Kho này không chứa dữ liệu người bệnh hay danh sách nhân viên.
