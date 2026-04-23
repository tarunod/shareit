# ShareIt - LAN/WiFi Folder & File Sync Tool

**ShareIt** is a powerful, lightweight P2P (Peer-to-Peer) synchronization tool designed for local area networks. It allows users to seamlessly share and sync folders and files across devices on the same WiFi or LAN without needing an internet connection.

![ShareIt Banner](https://via.placeholder.com/1200x400.png?text=ShareIt+-+Fast+Local+P2P+Sync)

---

## 🚀 Why ShareIt?

- **No Internet Required**: Works entirely over your local network. Your data never leaves your premises.
- **Blazing Fast**: Sync at the full speed of your LAN/WiFi (Gigabit ethernet, 5GHz WiFi).
- **Privacy First**: Direct device-to-device communication. No cloud servers, no trackers.
- **Set & Forget**: Once shared, folders sync automatically every 15 seconds whenever peers are online.
- **Cross-Device Discovery**: Automatically finds other ShareIt users on your network.

---

## 👥 Who Needs This?

- **Teams in Offices**: Instantly share design assets, documents, or code without slow cloud uploads.
- **Students**: Share study materials and large project files in hostels or libraries.
- **Home Users**: Sync photos and videos between your laptop, desktop, and home server.
- **Developers**: Keep local project folders in sync across multiple workstations.

---

## 🛠️ How It Works

ShareIt uses a modern tech stack to ensure reliability and speed:

1.  **Discovery**: Uses a custom peer discovery engine that broadcasts your presence on the local network. Peers find each other automatically.
2.  **Sharing**: When you share a folder or file, ShareIt starts a local HTTP server. Only authorized peers can access the file list and download content.
3.  **Watching**: Uses `chokidar` to monitor your shared folders for any changes (additions, modifications, deletions).
4.  **Syncing**: The recipient's app periodically (every 15s) checks for changes and downloads only the updated or missing parts of a file.
5.  **Storage**: By default, all synced files are stored in `C:\ShareIt\<PeerName>\<FolderName>`.

---

## 📥 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/tarunod/shareit.git
    cd shareit
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

### Running the App

- **Development Mode**:
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

### Building the Executable

To create a portable `.exe` for Windows:
```bash
npm run build
```
The installer will be generated in the `dist/` folder.

---

## 🤝 Contribution

Contributions make the open-source community an amazing place! Any contributions you make are **greatly appreciated**.

1.  **Fork** the Project
2.  Create your **Feature Branch** (`git checkout -b feature/AmazingFeature`)
3.  **Commit** your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  **Push** to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a **Pull Request**

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 📞 Contact

**Project Creator**: [Tarun](https://github.com/tarunod)
**Repository**: [https://github.com/tarunod/shareit](https://github.com/tarunod/shareit)

---
*Developed with ❤️ for fast, private local sharing.*
