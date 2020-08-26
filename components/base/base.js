/**
 * TODO:
 *  - LAZY LOAD IMAGES TO IMPROVE SPEED
 *  - INCREASE LOAD TIME BY REMOVING POPUPS IF APP WAS ALREADY RUN
 *  - GET ADDITIONAL INFORMATION FOR ITEMS IN THE BACKGROUND WITHOUT AMAZON BANNING
 */

// Load Bootstrap and JQuery
// This fixes an electron bug where importing these scripts via HTML tag causes an error to occur.
window.$ = window.jQuery = require("jquery");
window.Bootstrap = require("bootstrap");

const ipcRenderer = require("electron").ipcRenderer;
const Swal = require("sweetalert2");
const url = require("url");

// Constants
CACHED_ELEMENTS = {};
ICON_ERROR = 0x274c;
ICON_SUCCESS = 0x2714;
ICON_RETRY = 0x1f504;
ITEMS_PER_PAGE = 60; // The standard amount of items on each amazon page.
const VIEW_MAP = {
  "btn-search": {
    title: "SEARCH AMAZON ITEMS",
    id: "search",
  },
  "btn-bookmarks": {
    title: "MY BOOKMARKS",
    id: "bookmarks",
  },
  "btn-settings": {
    title: "SETTINGS",
    html: "settings",
  },
};

// State Variables
let settings;
let navigationBtn; // Current navigation page.
let categories = [];
let items = [];
let filteredItems = [];

// ================================================================================================
// INITIALIZATION FUNCTIONS
// ================================================================================================
window.addEventListener("load", async () => {
  initView();

  // Retrieve App Settings
  var result = await fetchSettings();
  settings = result.settings;

  // Check if category db can be updated
  var result = await checkCategoryDb();
  await sleep(6000);
  if (!result.error && result.canUpdate) {
    await updateCategoryDb();
    await sleep(6000);
  } else {
    $("#toast-2").remove();
  }

  // Load Categories
  // TODO: Store category info on update similar to how items are stored
  var result = await fetchCategories();
  if (!result.error) {
    categories = result.categories;
    console.log(categories);
    updateCategoryDropdown();
  }

  // Check if item db can be updated
  const itemDb = await checkItemDb();
  await sleep(6000);
  if (!itemDb.error && itemDb.canUpdate) {
    await updateItemDb();
    await sleep(6000);
  } else {
    $("#toast-4").remove();
    // Load Items
    var result = await fetchItems();
    if (!result.error) {
      items = result.items;
      console.log(items);
      await updateContainer(items);
    }
  }
});

$(document).on("ready", (event) => {
  $(".btn").mousedown(function (e) {
    e.preventDefault();
  });
});

function initView() {
  console.log("Loaded Base JS.  Loading View...");
  // Set currently selected button to "search"
  navigationBtn = $("#btn-search");
  // Update the title of the body
  $("#main-title").text("SEARCH AMAZON ITEMS");
  // Disable currently selected button
  navigationBtn.prop("disabled", true);
}

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateItemUrl(pn, cn, position) {
  // Create URL that only displays the item.
  // TODO: Fix bug where this does not work (sometimes shows wrong item)
  //       This may actually be an Amazon issue, as their product count
  //       tends to be inaccurate.
  return url.format({
    host: "https://www.amazon.com/vine/vine-items",
    query: { queue: "last_chance", size: 1, pn: pn, cn: cn, page: position },
  });
}

function ellipsify(str, maxlen) {
  if (str.length > maxlen) {
    return str.substring(0, maxlen) + "...";
  } else {
    return str;
  }
}

function tryRevertElementState(jqueryElement) {
  const id = jqueryElement.attr("id");
  if (CACHED_ELEMENTS[id] !== undefined) {
    // Set current html of the element to old html
    const html = CACHED_ELEMENTS[id].html();
    jqueryElement.html(html);
  } else {
    // Cache the element current state
    CACHED_ELEMENTS[id] = jqueryElement;
  }
}

function chunkify(arr, len) {
  var chunks = [],
    i = 0,
    n = arr.length;
  while (i < n) {
    chunks.push(arr.slice(i, (i += len)));
  }
  return chunks;
}

// ================================================================================================
// VIEW FUNCTIONS
// ================================================================================================
function updateView(btn) {
  console.log("Navigation Changed: Update View");
  const btnID = btn.getAttribute("id");
  const button = $(`#${btnID}`).prop("disabled", true);
  navigationBtn.prop("disabled", false);
  navigationBtn = button;
  $("#main-body").load(VIEW_MAP[btnID]["id"]);
  $("#main-title").text(VIEW_MAP[btnID]["title"]);
}

function updateToast(
  toast,
  { icon = null, iconIsEmoji = true, title = null, body = null, muted = null }
) {
  if (icon) {
    toast.find(".toast-icon").empty();
    if (iconIsEmoji) {
      toast.find(".toast-icon").text(String.fromCodePoint(icon));
    } else {
      toast.find(".toast-icon").html(icon);
    }
  }
  if (title) {
    toast.find(".toast-title > strong").text(title);
  }
  if (body) {
    toast.find(".toast-body").text(body);
    // toast.find(".toast-body").html().replace(/\n/g, "<br/>");
  }
  if (muted) {
    toast.find(".text-muted").text(muted);
  }
}

function handleError(result, toast, toastTitle, toastMsg, retry) {
  // Display Error Popup and Show Failure in Toast
  console.log(`Show Error to Display! ${result.msg}`);
  setTimeout(() => {
    Swal.fire({
      title: "An Error Occurred!",
      text: `${result.msg}`,
      icon: "error",
      showCancelButton: true,
      confirmButtonText: "Retry",
      cancelButtonText: "Cancel",
    }).then(async (result) => {
      if (result.value) {
        await retry();
      }
    });
    updateToast(toast, {
      icon: ICON_ERROR,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
}

function handleOk(toast, toastTitle, toastMsg) {
  // Update Toast and Hide Toast
  setTimeout(() => {
    updateToast(toast, {
      icon: ICON_SUCCESS,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
  setTimeout(() => {
    toast.toast("hide");
    toast.remove();
  }, 5000);
}

// ================================================================================================
// SEARCH FUNCTIONS
// ================================================================================================
function searchForm() {
  setTimeout(() => {
    applyFilter();
  }, 0);
  // For hitting enter in the form
  return false;
}

async function applyFilter() {
  // Collapse Filter
  setTimeout(() => {
    $("#collapseBody").collapse("hide");
  }, 0);

  const query = $("#filter-search").val().toLowerCase();

  // Get All Filter Values
  let category = $("#filter-category").val();
  let subcategory = $("#filter-subcategory").val();
  //const minTaxValue = parseInt($("#tax-value-min").val()) || 0;
  //const maxTaxValue = parseInt($("#tax-value-max").val()) || 2147483647;
  //const minRating = parseInt($("#min-rating").val()) || 0;

  console.log(category);
  console.log(subcategory);

  // Perform Filter
  filteredItems = items.filter((item) => {
    return (
      item.productName.toLowerCase().includes(query) &&
      (item.category === category || category === "default") &&
      (item.subcategory === subcategory || subcategory == "default")
      //item.taxValue >= minTaxValue &&
      //item.taxValue <= maxTaxValue &&
      //item.avgRating >= minRating
    );
  });

  console.log(filteredItems);
  filteredItems = sort(filteredItems);

  // Apply Filter if Changes
  await updateContainer(filteredItems)
    .then(console.log("Updated Container!"))
    .catch((error) => console.log(error));
}

async function clearFilter() {
  console.log("Clearing Filter!");
  $("#filter-search").val("");
  $("#tax-value-min").val("");
  $("#tax-value-max").val("");
  $("#min-rating").val("Any");
  $("#order-by").val("date-added");
  $("#order-direction").val("descending");
  filteredItems = items;
  updateItemsContainer(items);
}

function sort(items) {
  let sorted = items;
  const method = $("#order-by").val();
  const direction = $("#order-direction").val();
  switch (method) {
    case "default":
      break;
    case "name":
      sorted = Array.from(items).sort((a, b) => {
        return a.productName.localeCompare(b.productName, "en", { sensitivity: "base" });
      });
      break;
    case "tax-value":
      break;
    case "rating":
      break;
    case "retail-value":
      break;
    case "percent-diff":
      break;
  }
  if (direction == "ascending") {
    sorted.reverse();
  }
  return sorted;
}

async function updateContainer(items) {
  console.log("Updating item container.");
  clearItemContainer();
  for (chunk of chunkify(items, settings.max_threads)) {
    const promises = chunk.map((item) => addItemToContainer(item));
    await Promise.all(promises);
  }
}

async function addItemToContainer(item) {
  // Generate HTML for the Item if not Cached
  if (item.html === undefined) {
    // Generate fields and extract info to be placed in the HTML
    const page = Math.ceil(item.position / ITEMS_PER_PAGE);
    const category = categories.filter((category) => category.name === item.category)[0];
    const subcategory = category.subcategories.filter(
      (subcategory) => subcategory.name === item.subcategory
    )[0];
    const itemPageUrl = generateItemUrl(category.nodeId, subcategory.nodeId, item.position);

    // Bind HTML to item
    item.html = `
    <li class="media my-2 border rounded border-secondary">
      <img class="mr-3 img-thumbnail" src="${item.thumbnail}" width="125px">
        <div class="media-body">
        <div class="display-6 mt-2 mb-1">${item.productName}</div>
        <div class="mt-auto">
          <div class="badge badge-primary">${item.category}</div> &gt; 
          <div class="badge badge-secondary">${item.subcategory}</div> &gt; 
          <div class="badge badge-info">Page ${page}</div> &gt; 
          <div class="badge badge-info">Position ${item.position}</div>
        </div>
        <a href="${itemPageUrl}" target="_blank">View In Amazon</a>
      </div>
    </li>`;
  }

  // Run with Timeout to force DOM to update
  // (without timeout the DOM doesn't update until the end of all promises)
  setTimeout(() => {
    const container = $("#items-container > ul");
    // Append item to the container
    container.append(item.html);
    // Update Container Info
    updateSearchInfo(container.find("li").length);
  }, 0);
}

function clearItemContainer() {
  const container = $("#items-container > ul");
  updateSearchInfo(0);
  container.empty();
}

function updateSearchInfo(itemsFound) {
  // Change Search Result Number
  $("#search-info > div").text(`Search Results: ${itemsFound} Items Found`);
}

async function updateCategoryDropdown() {
  console.log("Updating Categories Dropdown List!");
  const categoryDropdown = $("#filter-category");
  const subcategoryDropdown = $("#filter-subcategory");
  categories.forEach((category) => {
    // Add the option to the category dropdown list (Force DOM to Update)
    setTimeout(() => {
      categoryDropdown.append(
        `<option value="${category.name}">${category.name} (${category.itemCount})</option>`
      );
    }, 0);
  });

  // Add event when selection changed to this category - update list of subcategories
  categoryDropdown.on("change", (event) => {
    var currentCategory = categoryDropdown.val();
    console.log(`Category Is Changed To ${currentCategory}`);
    const category = categories.filter((category) => category.name === currentCategory)[0];
    console.log(category);

    // Clear Subcategory and Add Default Option
    subcategoryDropdown.html("");
    subcategoryDropdown.append(`<option value="default" selected="">All</option>`);

    // Add Each Subcategory
    category.subcategories.forEach((subcategory) => {
      setTimeout(() => {
        subcategoryDropdown.append(
          `<option value="${subcategory.name}">${subcategory.name}</option>`
        );
      }, 0);
    });
  });
}

// ================================================================================================
// BACKEND FUNCTIONS
// ================================================================================================
async function checkCategoryDb() {
  // Display Toast
  const notification = $("#toast-1");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Category database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Category database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(
      notification,
      `Category Database ${result.canUpdate ? "Needs Update" : "OK"}`,
      result.msg
    );
  }

  return result;
}

async function updateCategoryDb() {
  // Display Toast
  const notification = $("#toast-2");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Retrieving Data...</span></div>`,
    iconIsEmoji: false,
    title: "Updating Category Database",
    body: `It's time for an update!  Updating the Category database...`,
  });
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Category Database",
      "Failed to update the category database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Category Database", result.msg);
  }

  return result;
}

async function checkItemDb() {
  // Display Toast
  const notification = $("#toast-3");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Item database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Item database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(notification, `Item Database ${result.canUpdate ? "Needs Update" : "OK"}`, result.msg);
  }

  return result;
}

async function updateItemDb() {
  // Display Toast
  const notification = $("#toast-4");
  tryRevertElementState(notification);
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Item Database",
      "Failed to update the item database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Item Database", result.msg);
  }

  return result;
}

async function fetchCategories() {
  // Fetch Categories
  const result = await ipcRenderer.invoke("fetch-db:categories");
  return result;
}

async function fetchItems() {
  // Fetch All Items
  const result = await ipcRenderer.invoke("fetch-db:items");
  console.log(result);
  return result;
}

async function fetchSettings() {
  const result = await ipcRenderer.invoke("fetch-settings");
  console.log(result);
  return result;
}

// ================================================================================================
// EVENT HANDLER FUNCTIONS
// ================================================================================================
ipcRenderer.on("update:category", (event, message) => {
  const notification = $("#toast-2");
  updateToast(notification, { body: message });
});

ipcRenderer.on("update:item", async (event, item, current, total) => {
  // Update Toast
  const notification = $("#toast-4");
  const completion = current / total;
  const message = `Got Item: ${ellipsify(item.productName, 40)}`;
  updateToast(notification, { muted: `${current}/${total}` });
  notification.find(".item-info").text(message);
  notification.find(".badge-primary").text(item.category);
  notification.find(".badge-secondary").text(item.subcategory);
  $("#toast-4 .progress-bar").attr("style", `width: ${completion * 100}%;`);

  // Add item to the container
  items.push(item);
  await addItemToContainer(item);
});

// ================================================================================================
// DEV FUNCTIONS
// ================================================================================================
async function wipeItemsDb(unlistedOnly = false) {
  const result = await ipcRenderer.invoke("wipe-db:items");
  console.log(result);
  location.reload();
}
