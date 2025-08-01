// Script that runs in the webview

(function () {
	const vscode = acquireVsCodeApi();

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data; // The json data that the extension sent
		switch (message.command) {
			case 'update':
				updateContent(message.header, message.metadata, message.tags);
				break;
			case 'error':
				showError(message.message);
				break;
		}
	});

	function updateContent(header, metadata, tags) {
		// Update header table
		updateTable('header-table', header);

		// Update metadata table
		updateTable('metadata-table', metadata);

		// Update tags tree
		updateTagsTree(tags);

		// Hide error message if any
		const errorMessage = document.getElementById('error-message');
		if (errorMessage) {
			errorMessage.textContent = '';
		}
	}

	function updateTable(tableId, data) {
		const tableBody = document.querySelector(`#${tableId} tbody`);
		if (!tableBody) return;

		// Clear existing content
		tableBody.innerHTML = '';

		// Populate table with data
		if (data && Object.keys(data).length > 0) {
			for (const [key, value] of Object.entries(data)) {
				const row = document.createElement('tr');
				const keyCell = document.createElement('td');
				const valueCell = document.createElement('td');

				keyCell.textContent = key;
				
				// Format value for better readability
				if (typeof value === 'object') {
					valueCell.textContent = JSON.stringify(value, null, 2);
				} else {
					valueCell.textContent = String(value);
				}

				row.appendChild(keyCell);
				row.appendChild(valueCell);
				tableBody.appendChild(row);
			}
		} else {
			const row = document.createElement('tr');
			const cell = document.createElement('td');
			cell.colSpan = 2;
			cell.textContent = 'No data available';
			row.appendChild(cell);
			tableBody.appendChild(row);
		}
	}

	function updateTagsTree(tags) {
		const tagsContent = document.getElementById('tags-content');
		if (!tagsContent) return;

		// Clear existing content
		tagsContent.innerHTML = '';

		if (!tags || tags.length === 0) {
			tagsContent.textContent = 'No tags found';
			return;
		}

		// Create tree structure
		tags.forEach((tag, index) => {
			const itemDiv = document.createElement('div');
			itemDiv.className = 'tree-item';

			const headerDiv = document.createElement('div');
			headerDiv.className = 'tree-item-header';
			headerDiv.textContent = `Tag ${index + 1}: ${tag.type.toUpperCase()} (${tag.dataSize} bytes, ${tag.timestamp}ms)`;

			const childrenDiv = document.createElement('div');
			childrenDiv.className = 'tree-item-children';

			// Add tag details
			const detailsPre = document.createElement('pre');
			detailsPre.className = 'tag-details';
			
			// Format details for better readability
			const details = { ...tag };
			delete details.details; // Remove details object to avoid duplication
			const formattedDetails = {
				...details,
				...tag.details
			};
			detailsPre.textContent = JSON.stringify(formattedDetails, null, 2);
			childrenDiv.appendChild(detailsPre);

			headerDiv.addEventListener('click', () => {
				headerDiv.classList.toggle('expanded');
				childrenDiv.classList.toggle('expanded');
			});

			itemDiv.appendChild(headerDiv);
			itemDiv.appendChild(childrenDiv);
			tagsContent.appendChild(itemDiv);
		});
	}

	function showError(message) {
		const errorMessage = document.getElementById('error-message');
		if (errorMessage) {
			errorMessage.textContent = message;
		}
	}
}());