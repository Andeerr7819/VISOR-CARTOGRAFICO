document.addEventListener("DOMContentLoaded", () => {
    const introScreen = document.getElementById("intro-screen");
    const mainContent = document.getElementById("main-content");
    const btnContinue = document.getElementById("btn-continue");
    const canvas = document.getElementById("particle-canvas");
    const ctx = canvas.getContext("2d");

    // ==========================================================================
    // PORTADA ANIMADA ORIGINAL
    // ==========================================================================
    if (canvas && ctx) {
        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;
        window.addEventListener("resize", () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        });
        const particles = [];
        for (let i = 0; i < 40; i++) {
            particles.push({
                x: Math.random() * width, y: Math.random() * height,
                radius: Math.random() * 1.5 + 0.8,
                speedX: (Math.random() - 0.5) * 0.2, speedY: (Math.random() - 0.5) * 0.2,
                color: "rgba(34, 197, 94, 0.6)"
            });
        }
        function animate() {
            ctx.clearRect(0, 0, width, height);
            particles.forEach(p => {
                p.x += p.speedX; p.y += p.speedY;
                if (p.x < 0 || p.x > width) p.speedX *= -1;
                if (p.y < 0 || p.y > height) p.speedY *= -1;
                ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
            });
            requestAnimationFrame(animate);
        }
        animate();
    }

    if (btnContinue) {
        btnContinue.addEventListener("click", () => {
            introScreen.classList.add("fade-out");
            mainContent.classList.remove("hidden");
            document.body.style.overflow = "auto";
            setTimeout(() => { initializeDynamicSIG(); }, 150);
        });
    }

    // ==========================================================================
    // MOTOR DE CONTROL DISCRIMINANTE DE CAPAS QGIS (FILTRO EXCLUSIVO DE TEMAS)
    // ==========================================================================
    function initializeDynamicSIG() {
        const map = L.map('map', { zoomControl: false }).setView([-2.90, -79.00], 9);
        L.control.zoom({ position: 'topleft' }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png').addTo(map);

        const fileInput = document.getElementById("input-zip-upload");
        const themesListContainer = document.getElementById("themes-list");
        const legendContainer = document.getElementById("legend-container");
        const aiReportContainer = document.getElementById("ai-report-container");

        let projectBounds = null;
        let capasRegistradasIA = {};

        // LISTA DE CONTROL EXCLUSIVA PARA EL EXAMEN (Cualquier capa que no esté aquí se ignora)
        const temasPermitidos = [
            { archivo: "PROVINCIA_DE_LAZUAY_1", nombre: "LÍMITES DE PROVINCIA", color: "#38bdf8" },
            { archivo: "CANTONESDELAZUAY_4", nombre: "DIVISIÓN CANTONAL", color: "#a855f7" },
            { archivo: "PARROQUIASDELAZUAY_15", nombre: "PARROQUIAS RURALES", color: "#ec4899" },
            { archivo: "CENTROSPOBLADOSAZUAY_20", nombre: "CENTROS POBLADOS", color: "#eab308" },
            { archivo: "REDVIALAZUAY_16", nombre: "RED VIAL PRINCIPAL", color: "#f97316" },
            { archivo: "AREASPROTEGIDASDELAZUAY_17", nombre: "ÁREAS PROTEGIDAS", color: "#10b981" },
            { archivo: "RIOS1DELAZUAY_10", nombre: "SISTEMA HIDROGRÁFICO", color: "#06b6d4" },
            { archivo: "TEMPERATURAAZUAY_18", nombre: "RÁSTER - MAPA TÉRMICO", color: "#ef4444", esRaster: true },
            { archivo: "COBERTURAYUSODESUELOAZUAY_9", nombre: "RÁSTER - USO DE SUELO", color: "#22c55e", esRaster: true },
            { archivo: "MAPAPENDIENTEDELAZUAY_3", nombre: "RÁSTER - MAPA DE PENDIENTES", color: "#6366f1", esRaster: true },
            { archivo: "MDTDELAPROVINCIADELAZUAY_8", nombre: "RÁSTER - MODELO ELEVACIÓN (MDT)", color: "#14b8a6", esRaster: true }
        ];

        if (fileInput) {
            fileInput.addEventListener("change", function(e) {
                const file = e.target.files[0];
                if (!file) return;

                themesListContainer.innerHTML = `
                    <div style="color: #94a3b8; font-size: 0.85rem; text-align: center; padding: 20px;">
                        <i class="fa-solid fa-filter fa-spin" style="color: #22C55E; font-size: 1.5rem; margin-bottom: 10px;"></i>
                        <p>Filtrando temas oficiales y acoplando coberturas ráster...</p>
                    </div>
                `;

                const reader = new FileReader();
                reader.onload = function(event) {
                    JSZip.loadAsync(event.target.result).then(async function(zip) {
                        themesListContainer.innerHTML = "";
                        legendContainer.innerHTML = "";
                        aiReportContainer.innerHTML = "";
                        projectBounds = null;
                        capasRegistradasIA = {};
                        let layerIdx = 0;

                        // Recorrer los archivos contenidos en el .zip
                        for (let path in zip.files) {
                            const entry = zip.files[path];
                            const rawFileName = path.split('/').pop().split('.').shift();

                            // VALIDACIÓN DE FILTRO CRÍTICA: Buscar si el archivo calza exactamente con la lista de temas permitidos
                            const configuracionTema = temasPermitidos.find(t => t.archivo === rawFileName);
                            
                            // Si el archivo no es un tema oficial del examen, lo saltamos de inmediato
                            if (!configuracionTema) continue;

                            // 1. PROCESADO VECTORIAL DE ARCHIVOS JS PERMITIDOS
                            if (!entry.dir && path.endsWith('.js') && !configuracionTema.esRaster) {
                                const rawText = await entry.async("string");
                                const jsonContent = rawText.replace(/^var\s+json_\w+\s*=\s*/, '').replace(/;\s*$/, '');
                                
                                try {
                                    const geojsonData = JSON.parse(jsonContent);
                                    layerIdx++;

                                    const mapLayer = L.geoJSON(geojsonData, {
                                        style: function(feature) {
                                            const type = feature.geometry ? feature.geometry.type : "";
                                            // Quitamos el relleno a la hidrografía y vías filtradas
                                            if (type.includes("LineString") || configuracionTema.nombre.includes("HIDRO") || configuracionTema.nombre.includes("VIAL")) {
                                                return { color: configuracionTema.color, weight: 1.8, opacity: 0.85, fill: false, fillColor: 'none' };
                                            }
                                            return { fillColor: configuracionTema.color, color: configuracionTema.color, weight: 1, fillOpacity: 0.22 };
                                        },
                                        onEachFeature: function(feature, layer) {
                                            if (feature.properties) {
                                                let p = `<div style="color:#cbd5e1; font-size:0.8rem; max-height:150px; overflow-y:auto;">`;
                                                for(let k in feature.properties) { p += `<b>${k}:</b> ${feature.properties[k]}<br>`; }
                                                layer.bindPopup(p + "</div>");
                                            }
                                        }
                                    }).addTo(map);

                                    // Usamos los cantones para fijar la extensión base exacta del Azuay
                                    if (configuracionTema.archivo.includes("CANTONES") || !projectBounds) {
                                        projectBounds = mapLayer.getBounds();
                                    } else {
                                        projectBounds.extend(mapLayer.getBounds());
                                    }

                                    capasRegistradasIA[configuracionTema.nombre] = true;
                                    inyectarElementoPanel(configuracionTema.nombre, configuracionTema.color, mapLayer, layerIdx, map, false);

                                } catch(err) {
                                    console.error(err);
                                }
                            }

                            // 2. PROCESADO RÁSTER DE IMÁGENES PERMITIDAS (.PNG / .JPG)
                            if (!entry.dir && (path.endsWith('.png') || path.endsWith('.jpg')) && configuracionTema.esRaster) {
                                const blob = await entry.async("blob");
                                const imgUrl = URL.createObjectURL(blob);
                                layerIdx++;
                                capasRegistradasIA[configuracionTema.nombre] = true;

                                // Superponer la cobertura ráster sobre el encuadre exacto calculado de los cantones
                                setTimeout(() => {
                                    const extensionAzuayFija = projectBounds || L.latLngBounds([-3.45, -79.95], [-2.45, -78.35]);
                                    const rasterLayer = L.imageOverlay(imgUrl, extensionAzuayFija, { opacity: 0.65 }).addTo(map);
                                    inyectarElementoPanel(configuracionTema.nombre, configuracionTema.color, rasterLayer, layerIdx, map, true);
                                }, 400);
                            }
                        }

                        // CLAVAR ENFOQUE DIRECTO EN AZUAY
                        if (projectBounds) {
                            map.invalidateSize();
                            map.fitBounds(projectBounds, { padding: [35, 35] });
                            actualizarInterpretacionIA();
                        }

                    }).catch(err => {
                        console.error(err);
                        themesListContainer.innerHTML = `<p style="color:#ef4444; font-size:0.8rem; text-align:center;">Error procesando el zip.</p>`;
                    });
                };
                reader.readAsArrayBuffer(file);
            });
        }

        // ==========================================================================
        // MOTOR DE ANÁLISIS E INTERPRETACIÓN AMBIENTAL DE LA IA
        // ==========================================================================
        function actualizarInterpretacionIA() {
            let reportHtml = "";
            let conteoActivas = 0;

            for (let nombre in capasRegistradasIA) {
                if (capasRegistradasIA[nombre]) conteoActivas++;
            }

            if (conteoActivas === 0) {
                aiReportContainer.innerHTML = `<p style="color: #64748b; text-align: center;">Prende capas en el menú para iniciar el análisis.</p>`;
                return;
            }

            reportHtml += `<p style="margin-bottom: 8px;"><span style="background: rgba(34, 197, 94, 0.15); color: #4ADE80; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight:600;">ANÁLISIS DE ${conteoActivas} TEMAS ACTIVOS</span></p>`;
            reportHtml += `<div style="background: rgba(255,255,255,0.01); border-left: 3px solid #22c55e; padding: 8px 10px; border-radius: 4px; font-size: 0.8rem; color: #cbd5e1;">`;

            let cruces = false;
            let tieneVias = capasRegistradasIA["RED VIAL PRINCIPAL"];
            let tieneAreas = capasRegistradasIA["ÁREAS PROTEGIDAS"];
            let tieneTermico = capasRegistradasIA["RÁSTER - MAPA TÉRMICO"];
            let tieneSuelo = capasRegistradasIA["RÁSTER - USO DE SUELO"];
            let tienePendientes = capasRegistradasIA["RÁSTER - MAPA DE PENDIENTES"];
            let tieneMdt = capasRegistradasIA["RÁSTER - MODELO ELEVACIÓN (MDT)"];

            if (tieneVias && tieneAreas) {
                reportHtml += `⚠️ <b>FRAGMENTACIÓN ECO-ESTRUCTURAL:</b> La infraestructura vial activa intersecta zonas de conservación biológica. Peligro elevado de pérdida de conectividad vegetal y aislamiento de ecosistemas frágiles.<br><br>`;
                cruces = true;
            }
            if (tieneTermico && tieneSuelo) {
                reportHtml += `🔥 <b>CORRELACIÓN MICROMETEOROLÓGICA:</b> El cruce térmico sobre el uso de suelo simula con claridad islas de calor sobre suelo desnudo y pastizales expuestos, confirmando la función reguladora de la cobertura boscosa nativa.<br><br>`;
                cruces = true;
            }
            if (tienePendientes && tieneMdt) {
                reportHtml += `🏔️ <b>DINÁMICA DE LADERAS Y GEOMORFOLOGÍA:</b> El análisis de inclinación de vertientes sobre el MDT delimita zonas de alta montaña críticas, propensas a fuertes tasas de escorrentía superficial y procesos de remoción en masa.<br><br>`;
                cruces = true;
            }
            if (conteoActivas >= 5) {
                reportHtml += `📊 <b>SÍNTESIS INTEGRAL DEL TERRITORIAL:</b> La integración combinada de variables vectoriales e imágenes espaciales define un escenario transitorio de <b>Vulnerabilidad Territorial Media-Alta</b>. Se recomienda adecuar los planes de mitigación locales (PDOT) enfocados en laderas críticas.`;
                cruces = true;
            }
            if (!cruces) {
                reportHtml += `🔎 <b>ANÁLISIS TEMÁTICO INDEPENDIENTE:</b> Evaluando mapas de manera aislada. Activa múltiples capas vectoriales o rásters combinados para que la IA inicie el modelamiento de impactos cruzados en tiempo real.`;
            }

            reportHtml += `</div>`;
            aiReportContainer.innerHTML = reportHtml;
        }

        function inyectarElementoPanel(nombre, color, layerInstance, id, mapInstance, isRaster) {
            const typeIcon = isRaster ? "fa-image" : (nombre.includes("VIAL") || nombre.includes("HIDRO") ? "fa-route" : "fa-draw-polygon");
            const cardHtml = `
                <div class="layer-item qgis-card" id="qgis-card-${id}" style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; margin-bottom: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 10px; max-width: 80%;">
                        <span style="background: ${color}; width: 10px; height: 10px; display: inline-block; border-radius: 50%; box-shadow: 0 0 8px ${color};"></span>
                        <h5 style="color: white; font-size: 0.8rem; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><i class="fa-solid ${typeIcon}" style="font-size:0.7rem; opacity:0.4; margin-right:4px;"></i>${nombre}</h5>
                    </div>
                    <input type="checkbox" id="check-layer-${id}" checked style="accent-color: #22C55E; cursor: pointer;">
                </div>
            `;
            themesListContainer.insertAdjacentHTML('beforeend', cardHtml);

            document.getElementById(`check-layer-${id}`).addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    mapInstance.addLayer(layerInstance);
                    capasRegistradasIA[nombre] = true;
                } else {
                    mapInstance.removeLayer(layerInstance);
                    capasRegistradasIA[nombre] = false;
                }
                actualizarInterpretacionIA();
            });

            document.getElementById(`qgis-card-${id}`).addEventListener('click', () => {
                if (typeof layerInstance.getBounds === 'function') mapInstance.fitBounds(layerInstance.getBounds(), { padding: [20, 20] });
                else if (projectBounds) mapInstance.fitBounds(projectBounds, { padding: [20, 20] });
            });

            legendContainer.insertAdjacentHTML('beforeend', `
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <span style="background:${color}; width:12px; height:12px; display:inline-block; border-radius:2px;"></span>
                    <span>${nombre}</span>
                </div>
            `);
        }

        document.getElementById('btn-zoom-provincia').addEventListener('click', () => {
            if (projectBounds) map.fitBounds(projectBounds, { padding: [30, 30] });
        });

        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });
    }
});