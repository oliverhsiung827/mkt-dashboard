import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyATSEmDeRBOAmRXb-5AaqrTI9EbGgVxs0g",
    authDomain: "mkt-pm-system.firebaseapp.com",
    projectId: "mkt-pm-system",
    storageBucket: "mkt-pm-system.firebasestorage.app",
    messagingSenderId: "457242310730",
    appId: "1:457242310730:web:6d929af5109e62ac5eceb3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };