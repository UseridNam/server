const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Persistent storage for all received data
let allData = [];  // Array to store all decibel data received
let decibelData = [];  // Array to store the last 50 decibel data points
let clients = [];  // Array to store connected WebSocket clients
let lastReceivedTime = Date.now(); // Last received timestamp in milliseconds

app.use(bodyParser.json());

// Helper function to convert milliseconds to HH:MM:SS
function formatTime(milliseconds) {
    const date = new Date(milliseconds);
    const hours = String(date.getUTCHours() + 3).padStart(2, '0'); // Adjusting for UTC+3 (Finland time)
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Endpoint to receive data from ESP32
app.post('/data', (req, res) => {
    const averages = req.body; // Expecting an array of averages with timestamp
    if (Array.isArray(averages) && averages.length > 0) {
        // Add the new averages to both the full dataset and the displayed dataset
        allData.push(...averages);  // Store all incoming data
        decibelData.push(...averages); // Store the last 50 data points for display

        // Limit decibelData to the last 50 entries
        if (decibelData.length > 50) {
            decibelData = decibelData.slice(-50);
        }

        console.log(`Received decibel data: ${averages.map(a => a.average).join(', ')} dB`);

        // Send the new average decibel data to all connected WebSocket clients
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                averages.forEach(data => {
                    const formattedTime = formatTime(data.timestamp); // Convert timestamp to HH:MM:SS
                    client.send(JSON.stringify({ timestamp: formattedTime, average: data.average }));
                });
            }
        });

        // Update last received time
        lastReceivedTime = Date.now();

        res.send('Data received');
    } else {
        res.status(400).send('Invalid data format');
    }
});

// Serve the webpage
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Decibel Level Plot</title>
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        </head>
        <body>
          <h2>Decibel Level Data Plot</h2>
          <div id="averagesDisplay" style="font-size: 18px; margin-bottom: 20px;"></div>
          <div id="dataCountDisplay" style="font-size: 18px; margin-bottom: 20px;"></div>
          <canvas id="decibelChart" width="400" height="200"></canvas>
          <button id="downloadBtn">Download All Data</button>
          <script>
            const ctx = document.getElementById('decibelChart').getContext('2d');
            let decibelData = [];
            let labels = [];
            
            const chart = new Chart(ctx, {
              type: 'line',
              data: {
                labels: labels,
                datasets: [{
                  label: 'Decibel Level (dB)',
                  data: decibelData,
                  borderColor: 'rgba(75, 192, 192, 1)',
                  borderWidth: 1,
                  fill: false
                }]
              },
              options: {
                scales: {
                  x: { 
                    title: { display: true, text: 'Time (HH:MM:SS)' },
                    ticks: { autoSkip: true, maxTicksLimit: 10 }
                  },
                  y: { 
                    title: { display: true, text: 'Decibel Level (dB)' },
                    min: 30,
                    max: 90
                  }
                }
              }
            });

            // Connect to WebSocket server
            const socket = new WebSocket('ws://' + window.location.host);
            
            // Handle incoming WebSocket messages
            socket.onmessage = function(event) {
              const data = JSON.parse(event.data);
              if (data.average !== undefined && data.timestamp !== undefined) {
                // Update the averages display
                const averagesDisplay = document.getElementById('averagesDisplay');
                averagesDisplay.innerHTML = 'Latest Averages: ' + data.average.toFixed(2) + ' dB';

                // Push the new data into the chart
                decibelData.push(data.average);
                labels.push(data.timestamp); // Use the formatted time for the x-axis labels
                
                // Limit to the last 50 data points
                if (decibelData.length > 50) {
                  decibelData.shift();
                  labels.shift();
                }

                chart.update();  // Update the chart with new data

                // Update the data count display
                const dataCountDisplay = document.getElementById('dataCountDisplay');
                dataCountDisplay.innerHTML = 'Number of Data Points on Graph: ' + decibelData.length;
              }
            };

            // Download all data when the button is clicked
            document.getElementById('downloadBtn').addEventListener('click', function() {
              window.location.href = '/download';
            });
          </script>
        </body>
        </html>
    `);
});

// Endpoint to download all data
app.get('/download', (req, res) => {
    const filePath = path.join(__dirname, 'allDecibelData.json');
    fs.writeFileSync(filePath, JSON.stringify(allData, null, 2)); // Write all data to JSON file

    res.download(filePath, 'allDecibelData.json', (err) => {
        if (err) {
            console.error('Error downloading the file:', err);
        } else {
            console.log('File downloaded successfully.');
        }
    });
});

// Create a WebSocket server
const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
    clients.push(ws);
    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
    });
});
