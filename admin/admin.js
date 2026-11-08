    // --- FIREBASE KONFIGURATION (används endast för "Logga in med Google") ---
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
    import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

    const firebaseConfig = {
      apiKey: "AIzaSyBiACXQ1Axel-nCLcqMWAoNyKq2rXf5M40",
      authDomain: "kraftfiske-851ca.firebaseapp.com",
      projectId: "kraftfiske-851ca",
      storageBucket: "kraftfiske-851ca.firebasestorage.app",
      messagingSenderId: "428654477143",
      appId: "1:428654477143:web:207c9ceebc39762643c812",
      measurementId: "G-1YLNB1M747"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();

    const scriptURL = "https://script.google.com/macros/s/AKfycbyOiqgPr37tvuuixXDvAYTnPiw1GojWCTqFL_851PccIhCCcPQZIanEpF80uQzqWvl7UA/exec"; 

    // Globala variabler
    window.currentUserUID = null;
    window.currentAuthToken = sessionStorage.getItem('adminToken') || null;
    let intervalId = null;
    let orders = [];
    let subscribers = [];
    let currentSort = { key: "timestamp", asc: false };
    let showAllOrders = false;
    let isInteracting = false; // Förhindrar re-renderings-buggar vid interaktion
    let lastOrdersHash = null; // Undviker att rita om tabellen när inget ändrats

    // DOM-element
    const loginScreen = document.getElementById("loginScreen");
    const appContent = document.getElementById("appContent");
    const loginError = document.getElementById("loginError");
    const loginLoading = document.getElementById("loginLoading");
    const adminAvailable = document.getElementById('adminAvailable');
    const adminPriceKokta = document.getElementById('adminPriceKokta');
    const adminPriceLevande = document.getElementById('adminPriceLevande');
    const inputAvailable = document.getElementById('inputAvailable');
    const inputPriceKokta = document.getElementById('inputPriceKokta');
    const inputPriceLevande = document.getElementById('inputPriceLevande');
    const metaResult = document.getElementById('metaResult');

    // Skyddar mot hängande nätverksanrop
    async function fetchWithTimeout(url, options = {}, ms = 8000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    // Alla admin-anrop skickar med uid (Firebase) och/eller token (lösenordsinloggning)
    function authPayload(extra) {
      return { uid: window.currentUserUID, token: window.currentAuthToken, ...extra };
    }

    async function callApi(payload, timeoutMs = 8000) {
      const res = await fetchWithTimeout(scriptURL, { method: "POST", body: JSON.stringify(payload) }, timeoutMs);
      return res.json();
    }

    function escapeHtml(str) { 
      if (str === undefined || str === null) return ''; 
      return String(str).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[m]; }); 
    }

    // --- INLOGGNING MED ANVÄNDARNAMN + LÖSENORD (hanteras i bladet "Användare") ---

    document.getElementById("passwordLoginBtn").addEventListener("click", handlePasswordLogin);
    document.getElementById("loginPassword").addEventListener("keydown", (e) => {
      if (e.key === "Enter") handlePasswordLogin();
    });

    async function handlePasswordLogin() {
      const username = document.getElementById("loginUsername").value.trim();
      const password = document.getElementById("loginPassword").value;
      if (!username || !password) {
        loginError.textContent = "Fyll i både användarnamn och lösenord.";
        loginError.style.display = "block";
        return;
      }

      const btn = document.getElementById("passwordLoginBtn");
      btn.disabled = true;
      loginError.style.display = "none";
      loginLoading.textContent = "Loggar in...";
      loginLoading.style.display = "block";

      try {
        const data = await callApi({ action: "login", username, password });
        loginLoading.style.display = "none";
        if (data.success) {
          window.currentUserUID = username;
          window.currentAuthToken = data.token;
          sessionStorage.setItem('adminToken', data.token);
          sessionStorage.setItem('adminUsername', username);
          await enterAdminPanel();
        } else {
          loginError.textContent = data.error || "Fel användarnamn eller lösenord.";
          loginError.style.display = "block";
        }
      } catch (err) {
        loginLoading.style.display = "none";
        loginError.textContent = "Nätverksfel vid inloggning.";
        loginError.style.display = "block";
      } finally {
        btn.disabled = false;
      }
    }

    // --- GOOGLE-INLOGGNING (Firebase) ---

    document.getElementById("googleLoginBtn").addEventListener("click", () => {
      loginError.style.display = "none";
      signInWithPopup(auth, provider).catch((error) => {
        loginError.textContent = "Inloggning avbröts eller misslyckades.";
        loginError.style.display = "block";
      });
    });

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        window.currentUserUID = user.uid;
        loginLoading.style.display = "block";
        loginError.style.display = "none";
        
        try {
          const data = await callApi({ action: "auth", uid: user.uid, email: user.email });
          loginLoading.style.display = "none";

          if (data.isAdmin) {
            await enterAdminPanel();
          } else {
            loginError.textContent = "Åtkomst nekad. Ditt konto saknar administratörsbehörighet.";
            loginError.style.display = "block";
            signOut(auth);
          }
        } catch (err) {
          loginLoading.style.display = "none";
          loginError.textContent = "Ett nätverksfel uppstod vid verifiering.";
          loginError.style.display = "block";
          signOut(auth);
        }
      } else if (!window.currentAuthToken) {
        // Visa bara inloggningsskärmen om vi inte redan är inloggade via användarnamn/lösenord
        window.currentUserUID = null;
        loginScreen.style.display = "flex";
        appContent.style.display = "none";
        stopAutoUpdate();
      }
    });

    // --- GEMENSAM INLOGGNING / UTLOGGNING ---

    async function enterAdminPanel() {
      loginScreen.style.display = "none";
      appContent.style.display = "block";
      await init();
      startAutoUpdate();
    }

    function handleAuthExpired() {
      stopAutoUpdate();
      sessionStorage.removeItem('adminToken');
      sessionStorage.removeItem('adminUsername');
      window.currentAuthToken = null;
      window.currentUserUID = null;
      loginScreen.style.display = "flex";
      appContent.style.display = "none";
      loginError.textContent = "Sessionen har gått ut. Logga in igen.";
      loginError.style.display = "block";
    }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      stopAutoUpdate();
      if (window.currentAuthToken) {
        try { await callApi({ action: "logout", token: window.currentAuthToken }); } catch (e) {}
      }
      sessionStorage.removeItem('adminToken');
      sessionStorage.removeItem('adminUsername');
      window.currentAuthToken = null;
      window.currentUserUID = null;
      if (auth.currentUser) {
        await signOut(auth); // triggar onAuthStateChanged -> visar inloggningsskärmen
      } else {
        loginScreen.style.display = "flex";
        appContent.style.display = "none";
      }
    });

    // Återuppta sparad session (användarnamn/lösenord) om sidan laddas om
    (async function tryResumeSession() {
      if (window.currentAuthToken) {
        window.currentUserUID = sessionStorage.getItem('adminUsername') || 'admin';
        await enterAdminPanel();
      }
    })();

    // --- FLIKAR ---

    document.querySelectorAll(".admin-nav a").forEach(link => {
      link.addEventListener("click", () => {
        const id = link.dataset.tab;
        document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".admin-nav a").forEach(a => a.classList.remove("active"));
        document.getElementById(id).classList.add("active");
        link.classList.add("active");
      });
    });

    // --- ADMIN PANEL LOGIC (Översikt) ---

    async function init() {
      await Promise.all([loadDashboard(), loadSubscribers(), loadEmailTemplates()]);
    }

    // Hämtar de sparade mailmallarna (från bladet "Mailmallar") och fyller i:
    // 1) fälten under fliken "Mailmallar" (de sparade mallarna, redigerbara/sparbara)
    // 2) ämne/meddelande i nyhetsbrevets skicka-formulär, men BARA om det är tomt
    //    sedan innan - så att en påbörjad, oskickad text aldrig skrivs över.
    async function loadEmailTemplates() {
      if (!window.currentUserUID) return;
      try {
        const data = await callApi(authPayload({ action: "getEmailTemplates" }));
        if (!data.success) return;

        const bSubjectEl = document.getElementById("bekraftelseSubject");
        const bBodyEl = document.getElementById("bekraftelseBody");
        if (bSubjectEl) bSubjectEl.value = (data.bekraftelse && data.bekraftelse.subject) || "";
        if (bBodyEl) bBodyEl.value = (data.bekraftelse && data.bekraftelse.body) || "";

        const nSubjectTplEl = document.getElementById("nyhetsbrevSubjectTpl");
        const nBodyTplEl = document.getElementById("nyhetsbrevBodyTpl");
        if (nSubjectTplEl) nSubjectTplEl.value = (data.nyhetsbrev && data.nyhetsbrev.subject) || "";
        if (nBodyTplEl) nBodyTplEl.value = (data.nyhetsbrev && data.nyhetsbrev.body) || "";

        const subjectEl = document.getElementById("newsletterSubject");
        const bodyEl = document.getElementById("newsletterBody");
        if (subjectEl && !subjectEl.value) subjectEl.value = (data.nyhetsbrev && data.nyhetsbrev.subject) || "";
        if (bodyEl && !bodyEl.value) bodyEl.value = (data.nyhetsbrev && data.nyhetsbrev.body) || "";
      } catch (err) {
        console.error(err);
      }
    }

    // --- Spara mall: bokningsbekräftelse ---
    document.getElementById("saveBekraftelseBtn").addEventListener("click", async () => {
      const subject = document.getElementById("bekraftelseSubject").value.trim();
      const body = document.getElementById("bekraftelseBody").value.trim();
      const resultEl = document.getElementById("bekraftelseSaveResult");
      if (!subject || !body) { resultEl.textContent = "Fyll i både ämne och meddelande."; return; }

      resultEl.textContent = "Sparar...";
      try {
        const json = await callApi(authPayload({ action: "updateEmailTemplates", bekraftelse: { subject, body } }));
        resultEl.textContent = json.success ? "Sparat!" : ("Fel: " + (json.error || "Okänt"));
        if (json.success) setTimeout(() => resultEl.textContent = "", 3000);
      } catch (err) {
        resultEl.textContent = "Nätverksfel vid sparande.";
      }
    });

    // --- Spara mall: nyhetsbrev (standardtext) ---
    document.getElementById("saveNyhetsbrevTplBtn").addEventListener("click", async () => {
      const subject = document.getElementById("nyhetsbrevSubjectTpl").value.trim();
      const body = document.getElementById("nyhetsbrevBodyTpl").value.trim();
      const resultEl = document.getElementById("nyhetsbrevSaveResult");
      if (!subject || !body) { resultEl.textContent = "Fyll i både ämne och meddelande."; return; }

      resultEl.textContent = "Sparar...";
      try {
        const json = await callApi(authPayload({ action: "updateEmailTemplates", nyhetsbrev: { subject, body } }));
        resultEl.textContent = json.success ? "Sparat!" : ("Fel: " + (json.error || "Okänt"));
        if (json.success) setTimeout(() => resultEl.textContent = "", 3000);
      } catch (err) {
        resultEl.textContent = "Nätverksfel vid sparande.";
      }
    });

    // --- Skicka testmail (används för att felsöka varför mail inte kommer fram -
    //     visar EXAKT felmeddelande från Gmail, t.ex. om avsändaraliaset
    //     olle@kopkraftor.se inte är verifierat) ---
    async function sendTestEmail(type, toInputId, resultElId, subjectFieldId, bodyFieldId) {
      const to = document.getElementById(toInputId).value.trim();
      const resultEl = document.getElementById(resultElId);
      if (!to) { resultEl.textContent = "Fyll i en mailadress att skicka till."; return; }

      const subject = document.getElementById(subjectFieldId).value.trim();
      const body = document.getElementById(bodyFieldId).value.trim();

      resultEl.textContent = "Skickar testmail...";
      try {
        const json = await callApi(authPayload({ action: "sendTestEmail", type, to, subject, body }), 20000);
        resultEl.textContent = json.success
          ? "Testmail skickat! Kolla inkorgen (och skräpposten)."
          : ("Kunde inte skicka: " + (json.error || "Okänt fel"));
      } catch (err) {
        resultEl.textContent = "Nätverksfel vid testutskick.";
      }
    }

    document.getElementById("sendTestBekraftelseBtn").addEventListener("click", () => {
      sendTestEmail("bekraftelse", "testEmailBekraftelse", "testBekraftelseResult", "bekraftelseSubject", "bekraftelseBody");
    });
    document.getElementById("sendTestNyhetsbrevBtn").addEventListener("click", () => {
      sendTestEmail("nyhetsbrev", "testEmailNyhetsbrev", "testNyhetsbrevResult", "nyhetsbrevSubjectTpl", "nyhetsbrevBodyTpl");
    });

    // Kombinerar lager/pris + beställningar i ETT anrop (var tidigare två separata)
    async function loadDashboard() {
      if (!window.currentUserUID) return;
      try {
        const data = await callApi(authPayload({ action: "getDashboard" }));
        if (!data.success) {
          if (data.error === "Behörighet saknas") handleAuthExpired();
          return;
        }

        adminAvailable.textContent = data.available + " kg";
        adminPriceKokta.textContent = data.prices.kokta + " kr/kg";
        adminPriceLevande.textContent = data.prices.levande + " kr/kg";

        if (document.activeElement !== inputAvailable) inputAvailable.value = data.available;
        if (document.activeElement !== inputPriceKokta) inputPriceKokta.value = data.prices.kokta;
        if (document.activeElement !== inputPriceLevande) inputPriceLevande.value = data.prices.levande;

        if (isInteracting) return; // rör inte ordertabellen medan admin redigerar/har en meny öppen

        const newOrders = data.orders.map(o => ({
          ...o,
          delivered: o.delivered === true || (o.delivered || "").toString().toLowerCase() === "levererad"
        }));

        // Rita bara om tabellen om datan faktiskt ändrats (undviker flimmer/onödigt DOM-arbete var 10:e sekund)
        const newHash = JSON.stringify(newOrders);
        if (newHash === lastOrdersHash) return;
        lastOrdersHash = newHash;

        orders = newOrders;
        sortOrdersInPlace();
        renderOrders(orders);
      } catch (err) {
        console.error(err);
      }
    }

    function sortOrdersInPlace() {
      orders.sort((a, b) => {
        let av = a[currentSort.key], bv = b[currentSort.key];
        if (currentSort.key === "kg" || currentSort.key === "total") { av = parseFloat(av); bv = parseFloat(bv); }
        if (currentSort.key === "timestamp") { av = new Date(av); bv = new Date(bv); }
        if (av < bv) return currentSort.asc ? -1 : 1;
        if (av > bv) return currentSort.asc ? 1 : -1;
        return 0;
      });
    }

    document.getElementById("saveMeta").addEventListener("click", async () => {
      const available = parseFloat(inputAvailable.value);
      const priceKokta = parseFloat(inputPriceKokta.value);
      const priceLevande = parseFloat(inputPriceLevande.value);

      metaResult.textContent = "Sparar...";

      try {
        const json = await callApi(authPayload({ action: "updateMeta", available, priceKokta, priceLevande }));
        if (json.success) {
          metaResult.textContent = "Uppdaterat!";
          await loadDashboard();
          setTimeout(() => metaResult.textContent = "", 3000);
        } else {
          metaResult.textContent = "Fel: " + (json.error || "Okänt");
        }
      } catch (err) {
        metaResult.textContent = "Fel vid uppdatering.";
      }
    });

    document.getElementById("setSoldOut").addEventListener("click", async () => {
      if (!confirm("Sätt tillgänglighet till 0 kg?")) return;
      metaResult.textContent = "Uppdaterar...";

      try {
        const json = await callApi(authPayload({ action: "setSoldOut" }));
        if (json.success) {
          await loadDashboard();
          metaResult.textContent = "Markerat som SLUT!";
          setTimeout(() => metaResult.textContent = "", 3000);
        } else {
          metaResult.textContent = "Fel: " + (json.error || "Okänt");
        }
      } catch (err) {
        metaResult.textContent = "Fel vid uppdatering.";
      }
    });

    function renderOrders(data) {
      const tbody = document.querySelector("#ordersTable tbody");
      tbody.innerHTML = "";

      const displayed = showAllOrders ? data : data.slice(0, 6);

      const totalKg = orders.reduce((sum, o) => sum + parseFloat(o.kg), 0);
      const totalKr = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
      const totalKraftor = Math.round(totalKg * 20);

      document.getElementById("ordersSummary").innerHTML = `
        Totalt: <strong>${totalKg.toFixed(1)} kg</strong> 
         ≈ ${totalKraftor} kräftor  -   
        <strong>${totalKr.toFixed(0)} kr</strong>
      `;

      displayed.forEach(order => {
        const tr = document.createElement("tr");
        const statusColor = order.delivered ? "green" : "red";
        const statusText = order.delivered ? "Levererad" : "Ej levererad";
        
        let tidKort = order.timestamp;
        try {
          const d = new Date(order.timestamp);
          if (!isNaN(d)) {
            tidKort = d.toLocaleString('sv-SE', { 
              year: 'numeric', month: '2-digit', day: '2-digit', 
              hour: '2-digit', minute: '2-digit' 
            });
          }
        } catch(e) {}

        tr.innerHTML = `
          <td>${escapeHtml(tidKort)}</td>
          <td class="editable" data-field="name">${escapeHtml(order.name)}</td>
          <td class="editable" data-field="type">${escapeHtml(order.type)}</td>
          <td class="editable" data-field="kg">${escapeHtml(String(order.kg))}</td>
          <td class="editable" data-field="total">${escapeHtml(String(order.total))}</td>
          <td style="position: relative;" class="action-cell">
            <button class="status-btn ${statusColor}" data-id="${order.id}" data-status="${order.delivered}">
              ${statusText}
            </button>
            <div class="order-menu-container">
              <button class="order-menu-btn">⋮</button>
              <div class="order-menu-dropdown">
                <button class="edit-order-btn" data-id="${order.id}">Redigera</button>
                <button class="delete-order-btn" data-id="${order.id}">Ta bort</button>
              </div>
            </div>
            
            <!-- Knappar som dyker upp vid redigering -->
            <div class="edit-actions" style="display:none;">
              <button class="btn-cancel">Avbryt</button>
              <button class="btn-save">Spara</button>
            </div>
          </td>
        `;

        tbody.appendChild(tr);

        // Menyer (Öppna / Stäng)
        tr.querySelector(".order-menu-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          const dropdown = tr.querySelector(".order-menu-dropdown");
          const td = tr.querySelector(".action-cell");
          const visible = dropdown.style.display === "block";
          
          document.querySelectorAll(".order-menu-dropdown").forEach(dd => dd.style.display = "none");
          document.querySelectorAll("td.active-menu").forEach(cell => cell.classList.remove("active-menu"));

          if (!visible) {
            dropdown.style.display = "block";
            td.classList.add("active-menu");
            isInteracting = true;
          } else {
            dropdown.style.display = "none";
            td.classList.remove("active-menu");
            isInteracting = false;
          }
        });

        // Delete (Ta bort)
        tr.querySelector(".delete-order-btn").addEventListener("click", async () => {
          if (!confirm("Ta bort denna beställning?")) return;
          isInteracting = true;
          
          const id = order.id;
          try {
            const json = await callApi(authPayload({ action: "deleteOrder", id }));
            isInteracting = false;
            if (json.success) { lastOrdersHash = null; loadDashboard(); }
            else alert("Fel: " + (json.error || "Okänt"));
          } catch (err) {
            isInteracting = false;
            alert("Nätverksfel vid borttagning.");
          }
        });

        // Redigera-knappen aktiverad
        tr.querySelector(".edit-order-btn").addEventListener("click", () => {
          isInteracting = true;

          // Dölj meny och status, visa Spara/Avbryt
          tr.querySelector('.status-btn').style.display = 'none';
          tr.querySelector('.order-menu-container').style.display = 'none';
          tr.querySelector('.edit-actions').style.display = 'flex';
          tr.querySelector(".action-cell").classList.remove("active-menu");

          // Byt till inputs
          const editableCells = tr.querySelectorAll(".editable");
          editableCells.forEach(td => {
            const field = td.dataset.field;
            const original = td.textContent.trim();
            const input = document.createElement("input");
            input.type = (field === "kg" || field === "total") ? "number" : "text";
            input.step = field === "kg" ? "0.1" : "1";
            input.className = "inline-edit";
            input.value = original;
            td.textContent = "";
            td.appendChild(input);
          });
        });

        // Avbryt
        tr.querySelector(".btn-cancel").addEventListener("click", () => {
          isInteracting = false;
          renderOrders(orders); // Laddar om lokala datan för att ta bort fälten
        });

        // Spara ändringar
        tr.querySelector(".btn-save").addEventListener("click", async (e) => {
          const btn = e.target;
          btn.textContent = "Sparar...";
          btn.disabled = true;

          const updates = {};
          tr.querySelectorAll(".editable").forEach(td => {
            const field = td.dataset.field;
            const input = td.querySelector("input");
            if (input) updates[field] = input.value.trim();
          });

          try {
            const json = await callApi(authPayload({ action: "editOrder", id: order.id, ...updates }));
            
            isInteracting = false;

            if (json.success) {
              lastOrdersHash = null;
              loadDashboard();
            } else {
              alert("Fel vid uppdatering: " + (json.error || ""));
              btn.textContent = "Spara";
              btn.disabled = false;
            }
          } catch(err) {
            isInteracting = false;
            alert("Nätverksfel vid sparande");
            btn.textContent = "Spara";
            btn.disabled = false;
          }
        });
      });

      // Toggle btn
      const toggleRow = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.style.textAlign = "center";
      td.innerHTML = `
        <button id="toggleOrdersBtn" style="margin-top:8px; padding:6px 12px; border-radius:6px; border:none; background:#891212; color:white; cursor:pointer;">
          ${showAllOrders ? "Visa mindre" : "Visa alla"}
        </button>
      `;
      toggleRow.appendChild(td);
      tbody.appendChild(toggleRow);

      document.getElementById("toggleOrdersBtn").addEventListener("click", () => {
        showAllOrders = !showAllOrders;
        renderOrders(orders);
      });

      // Status buttons
      document.querySelectorAll(".status-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          isInteracting = true;

          const id = btn.dataset.id;
          const current = btn.dataset.status === "true";
          const newStatus = !current;
          const originalText = btn.textContent;
          
          btn.textContent = "Sparar...";
          btn.disabled = true;

          try {
            const json = await callApi(authPayload({ action: "updateOrderStatus", id, delivered: newStatus }));
            if (json.success) {
              btn.textContent = newStatus ? "Levererad" : "Ej levererad";
              btn.classList.toggle("green", newStatus);
              btn.classList.toggle("red", !newStatus);
              btn.dataset.status = newStatus;
              const orderIndex = orders.findIndex(o => o.id == id);
              if (orderIndex !== -1) orders[orderIndex].delivered = newStatus;
              lastOrdersHash = JSON.stringify(orders);
            } else {
              btn.textContent = "Fel!";
              setTimeout(() => { btn.textContent = originalText; }, 1000);
            }
          } catch (err) {
            btn.textContent = "Fel!";
            setTimeout(() => { btn.textContent = originalText; }, 1500);
          } finally {
            btn.disabled = false;
            isInteracting = false;
          }
        });
      });

      // Sortering
      const headers = document.querySelectorAll("#ordersTable thead th");
      headers.forEach((th, i) => {
        if (!th.onclick) {
          const keys = ["timestamp","name","type","kg","total","delivered"];
          const key = keys[i];
          th.classList.add("sortable");
          th.style.cursor = "pointer";
          
          if(currentSort.key === key) {
            th.classList.add(currentSort.asc ? "asc" : "desc");
          }

          th.onclick = () => {
            if (currentSort.key === key) currentSort.asc = !currentSort.asc;
            else currentSort = { key, asc: true };
            
            headers.forEach(h => h.classList.remove("asc","desc"));
            th.classList.add(currentSort.asc ? "asc" : "desc");
            
            sortOrdersInPlace();
            renderOrders(orders);
          };
        }
      });
    }

    document.addEventListener("click", (e) => {
      const anyOpen = Array.from(document.querySelectorAll(".order-menu-dropdown"))
        .some(dd => dd.style.display === "block");
      
      document.querySelectorAll(".order-menu-dropdown").forEach(dd => dd.style.display = "none");
      document.querySelectorAll("td.active-menu").forEach(cell => cell.classList.remove("active-menu"));
      
      if (anyOpen && !document.querySelector(".inline-edit") && window.currentUserUID) {
        isInteracting = false;
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      document.getElementById("year").textContent = new Date().getFullYear();
    });

    // --- NYHETSBREV ---

    async function loadSubscribers() {
      if (!window.currentUserUID) return;
      try {
        const data = await callApi(authPayload({ action: "getSubscribers" }));
        if (data.success) {
          subscribers = data.subscribers;
          renderSubscribers();
        } else if (data.error === "Behörighet saknas") {
          handleAuthExpired();
        } else {
          document.getElementById("subscribersResult").textContent = "Kunde inte hämta prenumeranter.";
        }
      } catch (err) {
        console.error(err);
        document.getElementById("subscribersResult").textContent = "Nätverksfel vid hämtning av prenumeranter.";
      }
    }

    function renderSubscribers() {
      const tbody = document.querySelector("#subscribersTable tbody");
      tbody.innerHTML = "";
      document.getElementById("subscriberCount").textContent = subscribers.length;

      subscribers.forEach(sub => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><input type="checkbox" class="sub-check" data-id="${sub.id}" checked></td>
          <td class="editable" data-field="name">${escapeHtml(sub.name)}</td>
          <td class="editable" data-field="email">${escapeHtml(sub.email)}</td>
          <td class="editable" data-field="phone">${escapeHtml(sub.phone)}</td>
          <td>${escapeHtml(sub.added)}</td>
          <td style="white-space:nowrap;">
            <span class="sub-actions-view">
              <button type="button" class="edit-sub-btn">Redigera</button>
              <button type="button" class="delete-sub-btn">Ta bort</button>
            </span>
            <span class="sub-actions-edit" style="display:none;">
              <button type="button" class="cancel-sub-btn btn-cancel">Avbryt</button>
              <button type="button" class="save-sub-btn btn-save">Spara</button>
            </span>
          </td>
        `;
        tbody.appendChild(tr);

        const viewActions = tr.querySelector(".sub-actions-view");
        const editActions = tr.querySelector(".sub-actions-edit");
        const editableCells = tr.querySelectorAll(".editable");

        tr.querySelector(".delete-sub-btn").addEventListener("click", async () => {
          if (!confirm(`Ta bort ${sub.email} från listan?`)) return;
          try {
            const json = await callApi(authPayload({ action: "deleteSubscriber", id: sub.id }));
            if (json.success) loadSubscribers();
            else alert("Fel: " + (json.error || "Okänt"));
          } catch (err) {
            alert("Nätverksfel vid borttagning.");
          }
        });

        tr.querySelector(".edit-sub-btn").addEventListener("click", () => {
          viewActions.style.display = "none";
          editActions.style.display = "inline";
          editableCells.forEach(td => {
            const original = td.textContent.trim();
            const input = document.createElement("input");
            input.type = "text";
            input.className = "inline-edit";
            input.value = original;
            td.textContent = "";
            td.appendChild(input);
          });
        });

        tr.querySelector(".cancel-sub-btn").addEventListener("click", () => {
          renderSubscribers();
        });

        tr.querySelector(".save-sub-btn").addEventListener("click", async (e) => {
          const btn = e.target;
          btn.disabled = true;
          btn.textContent = "Sparar...";

          const updates = {};
          editableCells.forEach(td => {
            const field = td.dataset.field;
            const input = td.querySelector("input");
            if (input) updates[field] = input.value.trim();
          });

          try {
            const json = await callApi(authPayload({ action: "updateSubscriber", id: sub.id, ...updates }));
            if (json.success) {
              loadSubscribers();
            } else {
              alert("Fel: " + (json.error || "Okänt"));
              btn.disabled = false;
              btn.textContent = "Spara";
            }
          } catch (err) {
            alert("Nätverksfel vid sparande.");
            btn.disabled = false;
            btn.textContent = "Spara";
          }
        });
      });
    }

    document.getElementById("addSubscriberBtn").addEventListener("click", async () => {
      const name = document.getElementById("newSubName").value.trim();
      const email = document.getElementById("newSubEmail").value.trim();
      const phone = document.getElementById("newSubPhone").value.trim();
      const resultEl = document.getElementById("addSubscriberResult");
      if (!email) { resultEl.textContent = "E-post krävs."; return; }

      const btn = document.getElementById("addSubscriberBtn");
      btn.disabled = true;
      resultEl.textContent = "Lägger till...";
      try {
        const json = await callApi(authPayload({ action: "addSubscriber", name, email, phone }));
        if (json.success) {
          resultEl.textContent = "Tillagd!";
          document.getElementById("newSubName").value = "";
          document.getElementById("newSubEmail").value = "";
          document.getElementById("newSubPhone").value = "";
          await loadSubscribers();
          setTimeout(() => resultEl.textContent = "", 3000);
        } else {
          resultEl.textContent = "Fel: " + (json.error || "Okänt");
        }
      } catch (err) {
        resultEl.textContent = "Nätverksfel.";
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("selectAllBtn").addEventListener("click", () => {
      document.querySelectorAll(".sub-check").forEach(cb => cb.checked = true);
    });
    document.getElementById("selectNoneBtn").addEventListener("click", () => {
      document.querySelectorAll(".sub-check").forEach(cb => cb.checked = false);
    });

    document.getElementById("sendNewsletterBtn").addEventListener("click", async () => {
      const subject = document.getElementById("newsletterSubject").value.trim();
      const body = document.getElementById("newsletterBody").value.trim();
      const resultEl = document.getElementById("newsletterResult");
      if (!subject || !body) { resultEl.textContent = "Fyll i både ämne och meddelande."; return; }

      const checked = Array.from(document.querySelectorAll(".sub-check:checked")).map(cb => Number(cb.dataset.id));
      if (checked.length === 0) { resultEl.textContent = "Välj minst en mottagare."; return; }

      const totalSubs = subscribers.length;
      const confirmMsg = checked.length === totalSubs
        ? `Skicka till alla ${totalSubs} prenumeranter?`
        : `Skicka till ${checked.length} av ${totalSubs} prenumeranter?`;
      if (!confirm(confirmMsg)) return;

      const btn = document.getElementById("sendNewsletterBtn");
      btn.disabled = true;
      resultEl.textContent = "Skickar... kan ta upp till någon minut om ni har många prenumeranter.";
      try {
        const json = await callApi(
          authPayload({ action: "sendNewsletter", subject, body, recipientIds: checked }),
          120000 // 2 minuter - utskick till flera mottagare tar längre tid än vanliga anrop
        );
        if (json.success) {
          let msg = `Skickat till ${json.sent} av ${json.totalRequested}.`;
          if (json.failed) msg += ` ${json.failed} misslyckades${json.lastError ? " (t.ex: " + json.lastError + ")" : ""}.`;
          if (json.skippedDueToQuota) msg += ` ${json.skippedDueToQuota} kunde inte skickas (dagskvoten nådd).`;
          resultEl.textContent = msg;
        } else {
          resultEl.textContent = "Fel: " + (json.error || "Okänt");
        }
      } catch (err) {
        resultEl.textContent = "Nätverksfel vid utskick.";
      } finally {
        btn.disabled = false;
      }
    });

    // --- AUTO-UPPDATERING ---

    function startAutoUpdate() {
      if (!intervalId && window.currentUserUID) {
        intervalId = setInterval(loadDashboard, 10000); // ett kombinerat anrop var 10:e sekund
      }
    }

    function stopAutoUpdate() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAutoUpdate();
      } else if (window.currentUserUID) {
        loadDashboard();
        startAutoUpdate();
      }
    });

