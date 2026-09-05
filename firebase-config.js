// ========== КОНФИГУРАЦИЯ FIREBASE ==========
const firebaseConfig = {
    apiKey: "AIzaSyBVTnzhR1aoMbw5vDcccZKk3m8mUGBa8hM",
    authDomain: "kotnotsandbox.firebaseapp.com",
    databaseURL: "https://kotnotsandbox-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "kotnotsandbox",
    storageBucket: "kotnotsandbox.firebasestorage.app",
    messagingSenderId: "581361833067",
    appId: "1:581361833067:web:833427ec41708541c7cd2e"
};

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

console.log('🔥 Firebase инициализирован!');